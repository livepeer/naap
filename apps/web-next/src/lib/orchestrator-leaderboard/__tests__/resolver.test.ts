import { describe, it, expect } from 'vitest';
import { resolve, type ResolverConfig } from '../resolver';
import type { NormalizedOrch, SourceKind } from '../sources/types';

function mkConfig(overrides?: Partial<ResolverConfig>): ResolverConfig {
  return {
    sources: [
      { kind: 'livepeer-subgraph', priority: 1, enabled: true },
      { kind: 'clickhouse-query', priority: 2, enabled: true },
      { kind: 'naap-discover', priority: 3, enabled: true },
      { kind: 'naap-pricing', priority: 4, enabled: true },
    ],
    ...overrides,
  };
}

function mkSubgraphOrch(eth: string, uri: string): NormalizedOrch {
  return { ethAddress: eth, orchUri: uri, activationRound: 1, deactivationRound: 0 };
}

function mkClickhouseOrch(uri: string, cap: string): NormalizedOrch {
  return {
    orchUri: uri,
    gpuName: 'RTX 4090',
    gpuGb: 24,
    avail: 3,
    totalCap: 4,
    pricePerUnit: 100,
    bestLatMs: 50,
    avgLatMs: 80,
    swapRatio: 0.05,
    avgAvail: 3.2,
    capabilities: [cap],
  };
}

describe('resolve — membership', () => {
  it('only includes orchs from the membership source', () => {
    const perSource: Partial<Record<SourceKind, NormalizedOrch[]>> = {
      'livepeer-subgraph': [mkSubgraphOrch('0xaaa', 'https://orch-a.test')],
      'clickhouse-query': [
        mkClickhouseOrch('https://orch-a.test', 'noop'),
        mkClickhouseOrch('https://orch-unknown.test', 'noop'),
      ],
    };

    const result = resolve(perSource, mkConfig());
    expect(result.audit.totalOrchestrators).toBe(1);
    expect(result.audit.dropped).toHaveLength(1);
    expect(result.audit.dropped[0].orchKey).toContain('orch-unknown');
    expect(result.audit.dropped[0].reason).toContain('membership');
  });

  it('returns empty dataset when no sources are enabled', () => {
    const cfg = mkConfig({
      sources: [
        { kind: 'livepeer-subgraph', priority: 1, enabled: false },
        { kind: 'clickhouse-query', priority: 2, enabled: false },
      ],
    });
    const result = resolve({}, cfg);
    expect(result.audit.totalOrchestrators).toBe(0);
    expect(result.audit.warnings).toContain('No sources enabled — returning empty dataset');
  });

  it('uses second source as membership when first is disabled', () => {
    const cfg = mkConfig({
      sources: [
        { kind: 'livepeer-subgraph', priority: 1, enabled: false },
        { kind: 'clickhouse-query', priority: 2, enabled: true },
      ],
    });
    const perSource: Partial<Record<SourceKind, NormalizedOrch[]>> = {
      'clickhouse-query': [mkClickhouseOrch('https://orch-b.test', 'noop')],
    };

    const result = resolve(perSource, cfg);
    expect(result.audit.membershipSource).toBe('clickhouse-query');
    expect(result.audit.totalOrchestrators).toBe(1);
  });
});

describe('resolve — field merge', () => {
  it('merges fields from multiple sources', () => {
    const perSource: Partial<Record<SourceKind, NormalizedOrch[]>> = {
      'livepeer-subgraph': [mkSubgraphOrch('0xaaa', 'https://orch-a.test')],
      'clickhouse-query': [mkClickhouseOrch('https://orch-a.test', 'noop')],
      'naap-discover': [{
        orchUri: 'https://orch-a.test',
        capabilities: ['noop'],
        score: 0.95,
        recentWork: true,
        lastSeenMs: 1000,
      }],
    };

    const result = resolve(perSource, mkConfig());
    const noopRows = result.capabilities['noop'];
    expect(noopRows).toHaveLength(1);
    expect(noopRows[0].gpu_name).toBe('RTX 4090');
    expect(noopRows[0].orch_uri).toBe('https://orch-a.test');
  });

  it('records conflicts when multiple sources have the same field', () => {
    const perSource: Partial<Record<SourceKind, NormalizedOrch[]>> = {
      'livepeer-subgraph': [mkSubgraphOrch('0xaaa', 'https://orch-a.test')],
      'clickhouse-query': [{
        orchUri: 'https://orch-a.test',
        pricePerUnit: 100,
        capabilities: ['noop'],
      }],
      'naap-pricing': [{
        ethAddress: '0xaaa',
        pricePerUnit: 200,
        capabilities: ['noop'],
      }],
    };

    const result = resolve(perSource, mkConfig());
    const priceConflicts = result.audit.conflicts.filter(c => c.field === 'pricePerUnit');
    expect(priceConflicts.length).toBeGreaterThanOrEqual(1);
    expect(priceConflicts[0].winner).toBe('clickhouse-query');
  });
});

describe('resolve — ethAddress↔orchUri join', () => {
  it('joins orch by ethAddress when subgraph uses eth and clickhouse uses uri', () => {
    const perSource: Partial<Record<SourceKind, NormalizedOrch[]>> = {
      'livepeer-subgraph': [mkSubgraphOrch('0xbbb', 'https://orch-b.test')],
      'clickhouse-query': [mkClickhouseOrch('https://orch-b.test', 'noop')],
      'naap-pricing': [{
        ethAddress: '0xbbb',
        pricePerUnit: 150,
        capabilities: ['noop'],
      }],
    };

    const result = resolve(perSource, mkConfig());
    expect(result.audit.totalOrchestrators).toBe(1);
    const noopRows = result.capabilities['noop'];
    expect(noopRows).toHaveLength(1);
  });
});

describe('resolve — capability explosion', () => {
  it('creates per-capability rows from merged orch', () => {
    const perSource: Partial<Record<SourceKind, NormalizedOrch[]>> = {
      'livepeer-subgraph': [mkSubgraphOrch('0xccc', 'https://orch-c.test')],
      'clickhouse-query': [
        { orchUri: 'https://orch-c.test', gpuName: 'A100', gpuGb: 80, avail: 5, totalCap: 8, pricePerUnit: 50, bestLatMs: 30, avgLatMs: 40, swapRatio: 0.01, avgAvail: 6, capabilities: ['noop'] },
      ],
      'naap-discover': [
        { orchUri: 'https://orch-c.test', capabilities: ['noop', 'text-to-image'], score: 0.9 },
      ],
    };

    const result = resolve(perSource, mkConfig());
    expect(Object.keys(result.capabilities)).toContain('noop');
    expect(Object.keys(result.capabilities)).toContain('text-to-image');
    expect(result.capabilities['noop']).toHaveLength(1);
    expect(result.capabilities['text-to-image']).toHaveLength(1);
    expect(result.capabilities['noop'][0].orch_uri).toBe('https://orch-c.test');
    expect(result.capabilities['text-to-image'][0].orch_uri).toBe('https://orch-c.test');
  });

  it('excludes orchestrators with no capabilities (no __uncategorized)', () => {
    const perSource: Partial<Record<SourceKind, NormalizedOrch[]>> = {
      'livepeer-subgraph': [mkSubgraphOrch('0xddd', 'https://orch-d.test')],
    };

    const result = resolve(perSource, mkConfig());
    expect(result.capabilities['__uncategorized']).toBeUndefined();
    expect(Object.keys(result.capabilities)).toHaveLength(0);
  });
});

describe('resolve — output shape', () => {
  it('produces valid ClickHouseLeaderboardRow shape', () => {
    const perSource: Partial<Record<SourceKind, NormalizedOrch[]>> = {
      'livepeer-subgraph': [mkSubgraphOrch('0xeee', 'https://orch-e.test')],
      'clickhouse-query': [mkClickhouseOrch('https://orch-e.test', 'noop')],
    };

    const result = resolve(perSource, mkConfig());
    const row = result.capabilities['noop'][0];

    expect(row).toHaveProperty('orch_uri');
    expect(row).toHaveProperty('gpu_name');
    expect(row).toHaveProperty('gpu_gb');
    expect(row).toHaveProperty('avail');
    expect(row).toHaveProperty('total_cap');
    expect(row).toHaveProperty('price_per_unit');
    expect(row).toHaveProperty('best_lat_ms');
    expect(row).toHaveProperty('avg_lat_ms');
    expect(row).toHaveProperty('swap_ratio');
    expect(row).toHaveProperty('avg_avail');
    expect(typeof row.orch_uri).toBe('string');
    expect(typeof row.gpu_name).toBe('string');
    expect(typeof row.gpu_gb).toBe('number');
  });
});
