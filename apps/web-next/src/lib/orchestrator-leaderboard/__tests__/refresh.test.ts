import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { DiscoveryPlan } from '../types';

vi.mock('@naap/cache', () => {
  const store = new Map<string, { value: string; expiresAt: number }>();
  return {
    staleWhileRevalidate: vi.fn(async (fetcher: () => Promise<unknown>) => {
      const data = await fetcher();
      return { data, cache: 'MISS' as const };
    }),
    cacheGet: vi.fn(async (key: string) => {
      const entry = store.get(key);
      if (!entry || entry.expiresAt < Date.now()) return null;
      return JSON.parse(entry.value);
    }),
    cacheSet: vi.fn(async (key: string, value: unknown, opts?: { ttl?: number }) => {
      const ttl = opts?.ttl ?? 300;
      store.set(key, { value: JSON.stringify(value), expiresAt: Date.now() + ttl * 1000 });
    }),
    cacheDel: vi.fn(async () => {}),
    getRedis: vi.fn(() => null),
    isRedisConnected: vi.fn(() => false),
  };
});

vi.mock('../query', () => ({
  fetchLeaderboard: vi.fn().mockResolvedValue({
    rows: [
      {
        orch_uri: 'https://orch-1.example.com',
        gpu_name: 'RTX 4090',
        gpu_gb: 24,
        avail: 3,
        total_cap: 4,
        price_per_unit: 100,
        best_lat_ms: 50,
        avg_lat_ms: 80,
        swap_ratio: 0.05,
        avg_avail: 3.2,
      },
    ],
    fromCache: false,
    cachedAt: Date.now(),
  }),
}));

const { evaluateAndCache, clearPlanCache } = await import('../refresh');

const mockPlan: DiscoveryPlan = {
  id: 'plan-1',
  billingPlanId: 'bp-1',
  name: 'Test Plan',
  description: null,
  teamId: 'team-1',
  ownerUserId: 'user-1',
  capabilities: ['image-to-image'],
  topN: 10,
  slaWeights: null,
  slaMinScore: null,
  sortBy: null,
  filters: null,
  enabled: true,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

describe('evaluateAndCache', () => {
  beforeEach(async () => {
    await clearPlanCache();
  });

  afterEach(async () => {
    await clearPlanCache();
  });

  it('evaluates plan and returns results with cacheStatus', async () => {
    const results = await evaluateAndCache(mockPlan, 'test-token');
    expect(results.planId).toBe('plan-1');
    expect(results.capabilities['image-to-image']).toBeDefined();
    expect(results.capabilities['image-to-image'].length).toBeGreaterThan(0);
    expect(results.meta.totalOrchestrators).toBe(1);
    expect(results.cacheStatus).toBe('MISS');
  });

  it('returns results on second call', async () => {
    const first = await evaluateAndCache(mockPlan, 'test-token');
    const second = await evaluateAndCache(mockPlan, 'test-token');
    expect(second.planId).toBe(first.planId);
    expect(second.meta.cacheAgeMs).toBeGreaterThanOrEqual(0);
  });

  it('handles multiple capabilities', async () => {
    const multiPlan: DiscoveryPlan = {
      ...mockPlan,
      id: 'plan-multi',
      capabilities: ['cap-a', 'cap-b'],
    };
    const results = await evaluateAndCache(multiPlan, 'test-token');
    expect(Object.keys(results.capabilities)).toEqual(['cap-a', 'cap-b']);
  });

  it('exposes cacheStatus field', async () => {
    const results = await evaluateAndCache(mockPlan, 'test-token');
    expect(['HIT', 'STALE', 'MISS']).toContain(results.cacheStatus);
  });
});
