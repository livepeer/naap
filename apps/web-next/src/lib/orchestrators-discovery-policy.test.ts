/** @vitest-environment node */

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  applyDiscoveryPolicyToOrchestrators,
  applyPymthouseDiscoveryToOrchestrators,
} from '@/lib/orchestrators-discovery-policy';
import { mergeDiscoveryPolicies } from '@/lib/pymthouse-discovery-plans';
import {
  resetPymthouseManifestCacheForTests,
  seedPymthouseManifestForTests,
  syncPymthouseManifestSnapshot,
} from '@/lib/pymthouse-manifest';
import type { DashboardOrchestrator } from '@naap/plugin-sdk';

const baseRow = (over: Partial<DashboardOrchestrator>): DashboardOrchestrator => ({
  address: '0x1',
  uris: ['https://o.example/'],
  lastSeen: null,
  knownSessions: 10,
  successSessions: 9,
  successRatio: 90,
  effectiveSuccessRate: 90,
  noSwapRatio: 95,
  slaScore: 80,
  pipelines: ['llm'],
  pipelineModels: [{ pipelineId: 'llm', modelIds: ['m1'] }],
  gpuCount: 2,
  ...over,
});

describe('orchestrators-discovery-policy', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    resetPymthouseManifestCacheForTests();
  });

  it('applyDiscoveryPolicyToOrchestrators enforces slaMinScore without filters', () => {
    const rows = [
      baseRow({ address: '0xa', slaScore: 50, noSwapRatio: 99 }),
      baseRow({ address: '0xb', slaScore: 90, noSwapRatio: 98 }),
    ];
    const out = applyDiscoveryPolicyToOrchestrators(rows, { slaMinScore: 0.85 });
    expect(out).toHaveLength(1);
    expect(out[0].address).toBe('0xb');
  });

  it('applyDiscoveryPolicyToOrchestrators enforces slaMinScore with topN and sortBy', () => {
    const rows = [
      baseRow({ address: '0xa', slaScore: 50, noSwapRatio: 99 }),
      baseRow({ address: '0xb', slaScore: 90, noSwapRatio: 98 }),
    ];
    const out = applyDiscoveryPolicyToOrchestrators(rows, {
      slaMinScore: 0.85,
      topN: 1,
      sortBy: 'slaScore',
    });
    expect(out).toHaveLength(1);
    expect(out[0].address).toBe('0xb');
  });

  it('sortBy latency preserves input order (metric unavailable, no slaScore fallback)', () => {
    // DashboardOrchestrator exposes no per-row latency/price metric, so these
    // sort modes are treated as "metric unavailable" and must NOT silently
    // reorder by slaScore — the input order is preserved instead.
    const rows = [
      baseRow({ address: '0xa', knownSessions: 100, slaScore: 50 }),
      baseRow({ address: '0xb', knownSessions: 1, slaScore: 90 }),
    ];
    const out = applyDiscoveryPolicyToOrchestrators(rows, { sortBy: 'latency', topN: 2 });
    expect(out[0].address).toBe('0xa');
    expect(out[1].address).toBe('0xb');
  });

  it('sortBy price preserves input order (metric unavailable, no slaScore fallback)', () => {
    const rows = [
      baseRow({ address: '0xa', slaScore: 50 }),
      baseRow({ address: '0xb', slaScore: 90 }),
    ];
    const out = applyDiscoveryPolicyToOrchestrators(rows, { sortBy: 'price', topN: 2 });
    expect(out[0].address).toBe('0xa');
    expect(out[1].address).toBe('0xb');
  });

  it('mergeDiscoveryPolicies does not let user widen priceMax', () => {
    const merged = mergeDiscoveryPolicies(
      { filters: { priceMax: 10 } },
      { filters: { priceMax: 100 } },
    );
    expect(merged?.filters?.priceMax).toBe(10);
  });

  it('applyPymthouseDiscoveryToOrchestrators returns [] when allowlist blocks pipeline', async () => {
    vi.stubEnv('PYMTHOUSE_ISSUER_URL', 'http://localhost:9/api/v1/oidc');
    vi.stubEnv('PYMTHOUSE_PUBLIC_CLIENT_ID', 'pub');
    vi.stubEnv('PYMTHOUSE_M2M_CLIENT_ID', 'm2m');
    vi.stubEnv('PYMTHOUSE_M2M_CLIENT_SECRET', 'secret');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Promise.resolve({
          ok: true,
          json: async () => ({ capabilities: [{ pipeline: 'video', modelId: '*' }] }),
        } as Response),
      ),
    );
    await syncPymthouseManifestSnapshot();
    const rows = [baseRow({ address: '0xa' })];
    const out = await applyPymthouseDiscoveryToOrchestrators(rows, {
      pipeline: 'llm',
      modelId: 'm1',
    });
    expect(out).toEqual([]);
  });

  it('applyPymthouseDiscoveryToOrchestrators passes when pair is on allowlist and applies user topN', async () => {
    // Seed the snapshot directly: the SDK client is a process-wide singleton that
    // binds `fetch` on first construction, so routing this case through a stubbed
    // fetch is not deterministic across the suite.
    seedPymthouseManifestForTests({
      capabilities: [{ pipeline: 'llm', modelId: 'm1' }],
      excludedCapabilities: [],
    });
    const rows = [
      baseRow({ address: '0xa', slaScore: 60 }),
      baseRow({ address: '0xb', slaScore: 90 }),
    ];
    const out = await applyPymthouseDiscoveryToOrchestrators(rows, {
      pipeline: 'llm',
      modelId: 'm1',
      userDiscoveryPolicy: { topN: 1, sortBy: 'slaScore' },
    });
    expect(out).toHaveLength(1);
    expect(out[0].address).toBe('0xb');
  });

  it('applyPymthouseDiscoveryToOrchestrators denies when fetch fails without opt-in fail-open', async () => {
    vi.stubEnv('PYMTHOUSE_ISSUER_URL', 'http://localhost:9/api/v1/oidc');
    vi.stubEnv('PYMTHOUSE_PUBLIC_CLIENT_ID', 'pub');
    vi.stubEnv('PYMTHOUSE_M2M_CLIENT_ID', 'm2m');
    vi.stubEnv('PYMTHOUSE_M2M_CLIENT_SECRET', 'secret');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Promise.resolve({
          ok: false,
          json: async () => ({}),
        } as Response),
      ),
    );
    await syncPymthouseManifestSnapshot();
    const rows = [baseRow({ address: '0xa' }), baseRow({ address: '0xb' })];
    const out = await applyPymthouseDiscoveryToOrchestrators(rows, {
      pipeline: 'llm',
      modelId: 'm1',
    });
    expect(out).toHaveLength(0);
  });

  it('applyPymthouseDiscoveryToOrchestrators fail-open when fetch fails with opt-in env', async () => {
    vi.stubEnv('PYMTHOUSE_ISSUER_URL', 'http://localhost:9/api/v1/oidc');
    vi.stubEnv('PYMTHOUSE_PUBLIC_CLIENT_ID', 'pub');
    vi.stubEnv('PYMTHOUSE_M2M_CLIENT_ID', 'm2m');
    vi.stubEnv('PYMTHOUSE_M2M_CLIENT_SECRET', 'secret');
    vi.stubEnv('PYMTHOUSE_ALLOW_MISSING_MANIFEST_FAIL_OPEN', '1');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Promise.resolve({
          ok: false,
          json: async () => ({}),
        } as Response),
      ),
    );
    await syncPymthouseManifestSnapshot();
    const rows = [baseRow({ address: '0xa' }), baseRow({ address: '0xb' })];
    const out = await applyPymthouseDiscoveryToOrchestrators(rows, {
      pipeline: 'llm',
      modelId: 'm1',
    });
    expect(out).toHaveLength(2);
  });
});
