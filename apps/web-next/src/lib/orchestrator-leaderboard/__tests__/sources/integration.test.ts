/**
 * Integration tests for source adapters.
 *
 * Unit tests: validate parsing with synthetic data.
 * Live tests (skipped in CI): validate real network endpoints.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { FetchCtx, NormalizedOrch } from '../../sources/types';

const IS_CI = !!process.env.CI;

const internalCtx: FetchCtx = { authToken: 'test-token', internal: true };

// ---------------------------------------------------------------------------
// naap-discover — unit
// ---------------------------------------------------------------------------

vi.mock('../../sources/internal-resolve', () => ({
  resolveConnectorAuth: vi.fn().mockResolvedValue(null),
}));

describe('naap-discover adapter (unit)', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('parses response and normalizes capabilities', async () => {
    const mockResponse = [
      {
        address: 'https://ai-worker.example.com:8935',
        score: 0.95,
        capabilities: ['live-video-to-video/streamdiffusion-sdxl', 'text-to-image/Qwen3.6-27B'],
        last_seen_ms: 5000,
        last_seen: '2026-05-10T00:00:00Z',
        recent_work: true,
      },
      {
        address: 'https://another-orch.test:7953',
        score: 0.8,
        capabilities: ['llm/Qwen3.6-27B'],
        last_seen_ms: 10000,
        last_seen: '2026-05-09T00:00:00Z',
        recent_work: false,
      },
    ];

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockResponse),
    });

    const { naapDiscoverAdapter } = await import('../../sources/naap-discover');
    const result = await naapDiscoverAdapter.fetchAll(internalCtx);

    expect(result.stats.ok).toBe(true);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0].orchUri).toBe('https://ai-worker.example.com:8935');
    expect(result.rows[0].capabilities).toContain('streamdiffusion-sdxl');
    expect(result.rows[0].capabilities).toContain('Qwen3.6-27B');
    expect(result.rows[0].score).toBe(0.95);
    expect(result.rows[1].orchUri).toBe('https://another-orch.test:7953');
  });

  it('skips rows with undefined/empty capabilities', async () => {
    const mockResponse = [
      {
        address: 'https://valid.test:8935',
        score: 0.9,
        capabilities: ['llm/test-model'],
        last_seen_ms: 1000,
        last_seen: '2026-05-10T00:00:00Z',
        recent_work: true,
      },
      {
        address: 'https://no-caps.test:8935',
        score: 0.5,
        capabilities: null,
        last_seen_ms: 2000,
        last_seen: '2026-05-09T00:00:00Z',
        recent_work: false,
      },
      {
        address: 'https://empty-caps.test:8935',
        score: 0.4,
        capabilities: [],
        last_seen_ms: 3000,
        last_seen: '2026-05-09T00:00:00Z',
        recent_work: false,
      },
    ];

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockResponse),
    });

    const { naapDiscoverAdapter } = await import('../../sources/naap-discover');
    const result = await naapDiscoverAdapter.fetchAll(internalCtx);

    expect(result.stats.ok).toBe(true);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].orchUri).toBe('https://valid.test:8935');
  });
});

// ---------------------------------------------------------------------------
// livepeer-subgraph — unit
// ---------------------------------------------------------------------------

describe('livepeer-subgraph adapter (unit)', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('parses GraphQL transcoder response', async () => {
    const mockGraphQL = {
      data: {
        transcoders: [
          { id: '0xabc123', activationRound: '100', deactivationRound: '0', serviceURI: 'https://orch-a.test:8935', active: true },
          { id: '0xdef456', activationRound: '200', deactivationRound: '0', serviceURI: 'https://orch-b.test:8935', active: true },
        ],
      },
    };

    const { resolveConnectorAuth } = await import('../../sources/internal-resolve');
    (resolveConnectorAuth as ReturnType<typeof vi.fn>).mockResolvedValue({
      upstreamBaseUrl: 'https://gateway.thegraph.com',
      headers: { Authorization: 'Bearer test-key' },
    });

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockGraphQL),
      text: () => Promise.resolve(JSON.stringify(mockGraphQL)),
    });

    const { subgraphAdapter } = await import('../../sources/subgraph');
    const result = await subgraphAdapter.fetchAll(internalCtx);

    expect(result.stats.ok).toBe(true);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0].ethAddress).toBe('0xabc123');
    expect(result.rows[0].orchUri).toBe('https://orch-a.test:8935');
    expect(result.rows[0].activationRound).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// Resolver integration — verifies union membership includes discovery orchs
// ---------------------------------------------------------------------------

describe('resolver with union membership (integration)', () => {
  it('discovery-only orchestrators appear in final dataset', async () => {
    // Simulates the production scenario where AI orchestrators appear in
    // Discovery but NOT in the subgraph or ClickHouse.
    const { resolve } = await import('../../resolver');

    const perSource = {
      'livepeer-subgraph': [
        { ethAddress: '0xaaa', orchUri: 'https://staked-orch.test', activationRound: 1, deactivationRound: 0 },
      ] as NormalizedOrch[],
      'clickhouse-query': [
        { orchUri: 'https://staked-orch.test', gpuName: 'A100', gpuGb: 80, avail: 5, totalCap: 8, pricePerUnit: 50, bestLatMs: 30, avgLatMs: 40, swapRatio: 0.01, avgAvail: 6, capabilities: ['noop'] },
      ] as NormalizedOrch[],
      'naap-discover': [
        { orchUri: 'https://ai-only-worker.test:7953', capabilities: ['Qwen3.6-27B', 'streamdiffusion-sdxl'], score: 0.9 },
        { orchUri: 'https://another-ai.test:8935', capabilities: ['llm-generate'], score: 0.85 },
      ] as NormalizedOrch[],
    };

    const cfg = {
      sources: [
        { kind: 'livepeer-subgraph', priority: 1, enabled: true },
        { kind: 'clickhouse-query', priority: 2, enabled: true },
        { kind: 'naap-discover', priority: 3, enabled: true },
      ],
      membershipStrategy: 'union' as const,
    };

    const result = resolve(perSource, cfg);

    // All 3 unique orchestrators should be in the dataset
    expect(result.audit.totalOrchestrators).toBe(3);
    expect(result.audit.membershipSource).toContain('union');
    expect(result.audit.dropped).toHaveLength(0);

    // Discovery capabilities should be present
    expect(Object.keys(result.capabilities)).toContain('Qwen3.6-27B');
    expect(Object.keys(result.capabilities)).toContain('streamdiffusion-sdxl');
    expect(Object.keys(result.capabilities)).toContain('llm-generate');
    expect(Object.keys(result.capabilities)).toContain('noop');

    // Verify Discovery-only orchs have their data
    const qwenRows = result.capabilities['Qwen3.6-27B'];
    expect(qwenRows).toHaveLength(1);
    expect(qwenRows[0].orch_uri).toBe('https://ai-only-worker.test:7953');
  });
});

// ---------------------------------------------------------------------------
// Live integration tests (skipped in CI — run locally with `CI= npx vitest run ...`)
// ---------------------------------------------------------------------------

describe.skipIf(IS_CI)('naap-discover adapter (live)', () => {
  it('fetches real orchestrators from public Discovery API', async () => {
    // Call the public endpoint directly (bypasses mocks)
    const res = await globalThis.fetch('https://naap-api.cloudspe.com/v1/discover/orchestrators', {
      signal: AbortSignal.timeout(15_000),
    });
    expect(res.ok).toBe(true);
    const json = await res.json();
    const rows = Array.isArray(json) ? json : Array.isArray(json?.data) ? json.data : [];

    console.log(`[naap-discover live] Rows: ${rows.length}`);
    if (rows.length > 0) {
      console.log(`  Sample: ${rows[0].address} -> caps: ${rows[0].capabilities?.join(', ')}`);
    }

    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].address).toBeTruthy();
  });
});
