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
  getGlobalDatasetStats: vi.fn().mockResolvedValue({
    populated: true,
    refreshedAt: Date.now(),
    refreshedBy: 'test',
    totalOrchestrators: 1,
    capabilityCount: 1,
  }),
}));

vi.mock('../global-refresh', () => ({
  refreshGlobalDatasetOnStartup: vi.fn().mockResolvedValue({
    refreshed: true,
    capabilities: 1,
    orchestrators: 1,
  }),
}));

vi.mock('@/lib/pymthouse-manifest', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/pymthouse-manifest')>();
  return {
    ...actual,
    ensurePymthouseManifestFresh: vi.fn().mockResolvedValue({
      revision: 'test',
      revisionChanged: false,
    }),
  };
});

import {
  evaluateAndCache,
  clearPlanCache,
  getCachedPlanResults,
  invalidatePlanCache,
  warmDiscoveryPlan,
  planUpdateRequiresWarm,
} from '../refresh';
import { getRowsForCapability, getGlobalDatasetStats } from '../global-dataset';
import { refreshGlobalDatasetOnStartup } from '../global-refresh';
import { ensurePymthouseManifestFresh } from '@/lib/pymthouse-manifest';

const mockPlan: DiscoveryPlan = {
  id: 'plan-1',
  billingPlanId: 'bp-1',
  billingProviderSlug: null,
  name: 'Test Plan',
  description: null,
  visibility: 'personal',
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
    const results = await evaluateAndCache(mockPlan);
    expect(results.planId).toBe('plan-1');
    expect(results.capabilities['image-to-image']).toBeDefined();
    expect(results.capabilities['image-to-image'].length).toBeGreaterThan(0);
    expect(results.meta.totalOrchestrators).toBe(1);
  });

  it('caches results on first call', async () => {
    await evaluateAndCache(mockPlan);
    const cached = getCachedPlanResults('plan-1');
    expect(cached).not.toBeNull();
    expect(cached!.planId).toBe('plan-1');
  });

  it('returns cached results on second call without re-querying DB', async () => {
    const mockedGetRows = vi.mocked(getRowsForCapability);
    mockedGetRows.mockClear();
    const first = await evaluateAndCache(mockPlan);
    expect(mockedGetRows).toHaveBeenCalledTimes(1);
    const second = await evaluateAndCache(mockPlan);
    expect(mockedGetRows).toHaveBeenCalledTimes(1);
    expect(second.refreshedAt).toBe(first.refreshedAt);
    expect(second.meta.cacheAgeMs).toBeGreaterThanOrEqual(0);
  });

  it('clearPlanCache removes all entries', async () => {
    await evaluateAndCache(mockPlan);
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
    const results = await evaluateAndCache(multiPlan);
    expect(Object.keys(results.capabilities)).toEqual(['cap-a', 'cap-b']);
  });

  it('queries dataset by model suffix for pipeline/model capabilities', async () => {
    const mockedGetRows = vi.mocked(getRowsForCapability);
    mockedGetRows.mockClear();

    const pathPlan: DiscoveryPlan = {
      ...mockPlan,
      id: 'plan-path-cap',
      capabilities: ['live-video-to-video/streamdiffusion-sdxl'],
    };

    const results = await evaluateAndCache(pathPlan);
    expect(mockedGetRows).toHaveBeenCalledWith('streamdiffusion-sdxl');
    expect(results.capabilities['live-video-to-video/streamdiffusion-sdxl']).toBeDefined();
  });

  it('returns the newest cached variant for a plan id', async () => {
    vi.useFakeTimers();
    try {
      const planA: DiscoveryPlan = { ...mockPlan, id: 'plan-x', capabilities: ['c1'] };
      const planB: DiscoveryPlan = { ...mockPlan, id: 'plan-x', capabilities: ['c2'] };

      vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
      await evaluateAndCache(planA);
      vi.setSystemTime(new Date('2026-01-01T00:00:01.000Z'));
      await evaluateAndCache(planB);

      const cached = getCachedPlanResults('plan-x');
      expect(Object.keys(cached?.capabilities ?? {})).toEqual(['c2']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('invalidatePlanCache removes all composite-key entries for a plan id', async () => {
    const planA: DiscoveryPlan = { ...mockPlan, id: 'plan-x', capabilities: ['c1'] };
    const planB: DiscoveryPlan = { ...mockPlan, id: 'plan-x', capabilities: ['c2'] };
    await evaluateAndCache(planA);
    await evaluateAndCache(planB);
    expect(getCachedPlanResults('plan-x')).not.toBeNull();
    invalidatePlanCache('plan-x');
    expect(getCachedPlanResults('plan-x')).toBeNull();
  });
});

describe('warmDiscoveryPlan', () => {
  beforeEach(() => {
    clearPlanCache();
    vi.clearAllMocks();
    vi.mocked(getGlobalDatasetStats).mockResolvedValue({
      populated: true,
      refreshedAt: Date.now(),
      refreshedBy: 'test',
      totalOrchestrators: 1,
      capabilityCount: 1,
    });
  });

  afterEach(() => {
    clearPlanCache();
  });

  it('populates plan cache via refreshSingle', async () => {
    await warmDiscoveryPlan(mockPlan);
    expect(getCachedPlanResults('plan-1')).not.toBeNull();
  });

  it('triggers startup dataset refresh when global dataset is empty', async () => {
    vi.mocked(getGlobalDatasetStats).mockResolvedValue({
      populated: false,
      refreshedAt: null,
      refreshedBy: null,
      totalOrchestrators: 0,
      capabilityCount: 0,
    });

    await warmDiscoveryPlan(mockPlan);
    expect(refreshGlobalDatasetOnStartup).toHaveBeenCalled();
  });

  it('syncs pymthouse manifest for pymthouse plans', async () => {
    const pymthousePlan: DiscoveryPlan = {
      ...mockPlan,
      billingProviderSlug: 'pymthouse',
    };
    await warmDiscoveryPlan(pymthousePlan);
    expect(ensurePymthouseManifestFresh).toHaveBeenCalled();
  });
});

describe('planUpdateRequiresWarm', () => {
  it('returns true when evaluation fields change', () => {
    expect(planUpdateRequiresWarm({ capabilities: ['noop'] })).toBe(true);
    expect(planUpdateRequiresWarm({ topN: 5 })).toBe(true);
  });

  it('returns false for name-only updates', () => {
    expect(planUpdateRequiresWarm({ name: 'Renamed' })).toBe(false);
  });
});
