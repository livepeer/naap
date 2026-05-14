/**
 * Global Dataset + Config Unit Tests
 *
 * Tests the global dataset cache, config service, time-gated cron logic,
 * and plan evaluation reading from the global dataset.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Global Dataset Cache
// ---------------------------------------------------------------------------

describe('global-dataset cache', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns null when not populated', async () => {
    const { getGlobalDataset, clearGlobalDataset } = await import(
      '@/lib/orchestrator-leaderboard/global-dataset'
    );
    clearGlobalDataset();
    expect(getGlobalDataset()).toBeNull();
  });

  it('stores and returns dataset within TTL', async () => {
    const { setGlobalDataset, getGlobalDataset, clearGlobalDataset } =
      await import('@/lib/orchestrator-leaderboard/global-dataset');
    clearGlobalDataset();

    const dataset = {
      capabilities: {
        noop: [
          {
            orch_uri: 'https://orch-1.test',
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
      },
      refreshedAt: Date.now(),
      refreshedBy: 'test',
      totalOrchestrators: 1,
    };

    setGlobalDataset(dataset, 3_600_000); // 1h interval -> 2h TTL
    expect(getGlobalDataset()).not.toBeNull();
    expect(getGlobalDataset()!.totalOrchestrators).toBe(1);
  });

  it('returns null after TTL expires', async () => {
    const { setGlobalDataset, getGlobalDataset, clearGlobalDataset } =
      await import('@/lib/orchestrator-leaderboard/global-dataset');
    clearGlobalDataset();

    setGlobalDataset(
      {
        capabilities: {},
        refreshedAt: Date.now(),
        refreshedBy: 'test',
        totalOrchestrators: 0,
      },
      1_000, // 1s interval -> 2s TTL
    );

    expect(getGlobalDataset()).not.toBeNull();

    vi.advanceTimersByTime(3_000); // past 2s TTL
    expect(getGlobalDataset()).toBeNull();
  });

  it('isGlobalDatasetFresh checks against given interval', async () => {
    const {
      setGlobalDataset,
      isGlobalDatasetFresh,
      clearGlobalDataset,
    } = await import('@/lib/orchestrator-leaderboard/global-dataset');
    clearGlobalDataset();

    setGlobalDataset(
      {
        capabilities: {},
        refreshedAt: Date.now(),
        refreshedBy: 'test',
        totalOrchestrators: 0,
      },
      3_600_000,
    );

    expect(isGlobalDatasetFresh(3_600_000)).toBe(true);
    vi.advanceTimersByTime(3_700_000); // past 1h interval
    expect(isGlobalDatasetFresh(3_600_000)).toBe(false);
  });

  it('full replace overwrites previous data', async () => {
    const { setGlobalDataset, getGlobalDataset, clearGlobalDataset } =
      await import('@/lib/orchestrator-leaderboard/global-dataset');
    clearGlobalDataset();

    setGlobalDataset(
      {
        capabilities: { cap1: [] },
        refreshedAt: Date.now(),
        refreshedBy: 'v1',
        totalOrchestrators: 0,
      },
      3_600_000,
    );

    setGlobalDataset(
      {
        capabilities: { cap2: [] },
        refreshedAt: Date.now(),
        refreshedBy: 'v2',
        totalOrchestrators: 5,
      },
      3_600_000,
    );

    const ds = getGlobalDataset()!;
    expect(ds.refreshedBy).toBe('v2');
    expect(ds.totalOrchestrators).toBe(5);
    expect('cap1' in ds.capabilities).toBe(false);
    expect('cap2' in ds.capabilities).toBe(true);
  });

  it('getGlobalDatasetStats returns correct stats', async () => {
    const {
      setGlobalDataset,
      getGlobalDatasetStats,
      clearGlobalDataset,
    } = await import('@/lib/orchestrator-leaderboard/global-dataset');
    clearGlobalDataset();

    let stats = getGlobalDatasetStats();
    expect(stats.populated).toBe(false);
    expect(stats.totalOrchestrators).toBe(0);

    setGlobalDataset(
      {
        capabilities: { a: [], b: [] },
        refreshedAt: Date.now(),
        refreshedBy: 'cron',
        totalOrchestrators: 10,
      },
      3_600_000,
    );

    stats = getGlobalDatasetStats();
    expect(stats.populated).toBe(true);
    expect(stats.capabilityCount).toBe(2);
    expect(stats.totalOrchestrators).toBe(10);
    expect(stats.refreshedBy).toBe('cron');
  });
});

// ---------------------------------------------------------------------------
// Config Service
// ---------------------------------------------------------------------------

const mockUpsert = vi.fn();

vi.mock('@/lib/db', () => ({
  prisma: {
    leaderboardConfig: {
      upsert: (...args: unknown[]) => mockUpsert(...args),
    },
  },
}));

describe('config service', () => {
  beforeEach(async () => {
    vi.resetModules();
    mockUpsert.mockReset();
  });

  it('isValidInterval accepts allowed values', async () => {
    const { isValidInterval } = await import(
      '@/lib/orchestrator-leaderboard/config'
    );
    expect(isValidInterval(1)).toBe(true);
    expect(isValidInterval(4)).toBe(true);
    expect(isValidInterval(8)).toBe(true);
    expect(isValidInterval(12)).toBe(true);
    expect(isValidInterval(3)).toBe(false);
    expect(isValidInterval(0)).toBe(false);
    expect(isValidInterval('4')).toBe(false);
    expect(isValidInterval(null)).toBe(false);
  });

  it('getConfig returns DTO from upserted row', async () => {
    mockUpsert.mockResolvedValue({
      id: 'singleton',
      refreshIntervalHours: 4,
      lastRefreshedAt: new Date('2025-01-01T00:00:00Z'),
      lastRefreshedBy: 'cron',
      updatedAt: new Date('2025-01-01T00:00:00Z'),
    });

    const { getConfig } = await import(
      '@/lib/orchestrator-leaderboard/config'
    );
    const config = await getConfig();
    expect(config.refreshIntervalHours).toBe(4);
    expect(config.lastRefreshedAt).toBe('2025-01-01T00:00:00.000Z');
    expect(config.lastRefreshedBy).toBe('cron');
  });

  it('updateConfig rejects invalid intervals', async () => {
    const { updateConfig } = await import(
      '@/lib/orchestrator-leaderboard/config'
    );
    await expect(updateConfig(3 as any)).rejects.toThrow(
      'refreshIntervalHours must be one of',
    );
  });

  it('updateConfig upserts with valid interval', async () => {
    mockUpsert.mockResolvedValue({
      id: 'singleton',
      refreshIntervalHours: 8,
      lastRefreshedAt: null,
      lastRefreshedBy: null,
      updatedAt: new Date(),
    });

    const { updateConfig } = await import(
      '@/lib/orchestrator-leaderboard/config'
    );
    const config = await updateConfig(8);
    expect(config.refreshIntervalHours).toBe(8);
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'singleton' },
        update: { refreshIntervalHours: 8 },
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// Plan evaluation reads from global dataset
// ---------------------------------------------------------------------------

describe('plan evaluation with global dataset', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('uses global dataset rows when available', async () => {
    const globalDatasetModule = await import(
      '@/lib/orchestrator-leaderboard/global-dataset'
    );

    globalDatasetModule.clearGlobalDataset();
    globalDatasetModule.setGlobalDataset(
      {
        capabilities: {
          noop: [
            {
              orch_uri: 'https://global-orch.test',
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
        },
        refreshedAt: Date.now(),
        refreshedBy: 'test',
        totalOrchestrators: 1,
      },
      3_600_000,
    );

    const { evaluatePlan } = await import(
      '@/lib/orchestrator-leaderboard/ranking'
    );

    const globalDs = globalDatasetModule.getGlobalDataset()!;
    const rows = globalDs.capabilities['noop'];

    const result = evaluatePlan(rows, {
      filters: null,
      slaWeights: null,
      slaMinScore: null,
      sortBy: null,
      topN: 10,
    });

    expect(result).toHaveLength(1);
    expect(result[0].orchUri).toBe('https://global-orch.test');
  });
});
