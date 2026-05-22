import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { DiscoveryPlan } from '../types';

vi.mock('@/lib/db', () => ({
  prisma: {
    leaderboardDatasetRow: {
      findMany: vi.fn(),
    },
  },
}));

vi.mock('../global-dataset', () => ({
  getRowsForCapability: vi.fn().mockResolvedValue([
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
  ]),
}));

import { evaluateAndCache, clearPlanCache, getCachedPlanResults } from '../refresh';
import { getRowsForCapability } from '../global-dataset';

const mockPlan: DiscoveryPlan = {
  id: 'plan-1',
  billingPlanId: 'bp-1',
  name: 'Test Plan',
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
  beforeEach(() => {
    clearPlanCache();
  });

  afterEach(() => {
    clearPlanCache();
  });

  it('evaluates plan and returns results', async () => {
    const results = await evaluateAndCache(mockPlan, 'test-token');
    expect(results.planId).toBe('plan-1');
    expect(results.capabilities['image-to-image']).toBeDefined();
    expect(results.capabilities['image-to-image'].length).toBeGreaterThan(0);
    expect(results.meta.totalOrchestrators).toBe(1);
  });

  it('caches results on first call', async () => {
    await evaluateAndCache(mockPlan, 'test-token');
    const cached = getCachedPlanResults('plan-1');
    expect(cached).not.toBeNull();
    expect(cached!.planId).toBe('plan-1');
  });

  it('returns cached results on second call without re-querying DB', async () => {
    const mockedGetRows = vi.mocked(getRowsForCapability);
    mockedGetRows.mockClear();
    const first = await evaluateAndCache(mockPlan, 'test-token');
    expect(mockedGetRows).toHaveBeenCalledTimes(1);
    const second = await evaluateAndCache(mockPlan, 'test-token');
    expect(mockedGetRows).toHaveBeenCalledTimes(1);
    expect(second.refreshedAt).toBe(first.refreshedAt);
    expect(second.meta.cacheAgeMs).toBeGreaterThanOrEqual(0);
  });

  it('clearPlanCache removes all entries', async () => {
    await evaluateAndCache(mockPlan, 'test-token');
    expect(getCachedPlanResults('plan-1')).not.toBeNull();
    clearPlanCache();
    expect(getCachedPlanResults('plan-1')).toBeNull();
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
});
