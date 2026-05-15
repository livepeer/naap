/**
 * Global Dataset + Config Unit Tests
 *
 * Tests the DB-backed global dataset functions, config service,
 * and plan evaluation reading from the persistent dataset table.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockFindMany = vi.fn();
const mockDeleteMany = vi.fn();
const mockCreateMany = vi.fn();
const mockCount = vi.fn();
const mockConfigFindUnique = vi.fn();
const mockConfigUpsert = vi.fn();

const mockPrisma = {
  leaderboardDatasetRow: {
    findMany: (...args: unknown[]) => mockFindMany(...args),
    deleteMany: (...args: unknown[]) => mockDeleteMany(...args),
    createMany: (...args: unknown[]) => mockCreateMany(...args),
    count: (...args: unknown[]) => mockCount(...args),
  },
  leaderboardConfig: {
    findUnique: (...args: unknown[]) => mockConfigFindUnique(...args),
    upsert: (...args: unknown[]) => mockConfigUpsert(...args),
  },
  $transaction: vi.fn(async (input: unknown) => {
    if (typeof input === 'function') {
      return (input as (tx: typeof mockPrisma) => Promise<void>)(mockPrisma);
    }
    for (const op of input as Promise<unknown>[]) await op;
  }),
};

vi.mock('@/lib/db', () => ({
  prisma: mockPrisma,
}));

// ---------------------------------------------------------------------------
// DB-Backed Global Dataset
// ---------------------------------------------------------------------------

describe('global-dataset (DB-backed)', () => {
  beforeEach(() => {
    vi.resetModules();
    mockFindMany.mockReset();
    mockDeleteMany.mockReset();
    mockCreateMany.mockReset();
    mockCount.mockReset();
    mockConfigFindUnique.mockReset();
    mockConfigUpsert.mockReset();
  });

  it('getRowsForCapability returns mapped rows from DB', async () => {
    mockFindMany.mockResolvedValue([
      {
        id: 'row-1',
        capability: 'noop',
        orchUri: 'https://orch-1.test',
        gpuName: 'RTX 4090',
        gpuGb: 24,
        avail: 3,
        totalCap: 4,
        pricePerUnit: 100,
        bestLatMs: 50,
        avgLatMs: 80,
        swapRatio: 0.05,
        avgAvail: 3.2,
        refreshedAt: new Date(),
      },
    ]);

    const { getRowsForCapability } = await import(
      '@/lib/orchestrator-leaderboard/global-dataset'
    );

    const rows = await getRowsForCapability('noop');
    expect(rows).toHaveLength(1);
    expect(rows[0].orch_uri).toBe('https://orch-1.test');
    expect(rows[0].gpu_name).toBe('RTX 4090');
    expect(rows[0].gpu_gb).toBe(24);
    expect(rows[0].best_lat_ms).toBe(50);
  });

  it('getRowsForCapability returns empty when no rows', async () => {
    mockFindMany.mockResolvedValue([]);

    const { getRowsForCapability } = await import(
      '@/lib/orchestrator-leaderboard/global-dataset'
    );

    const rows = await getRowsForCapability('nonexistent');
    expect(rows).toHaveLength(0);
  });

  it('getDatasetCapabilities returns distinct capabilities', async () => {
    mockFindMany.mockResolvedValue([
      { capability: 'glm-4.7-flash' },
      { capability: 'streamdiffusion-sdxl' },
    ]);

    const { getDatasetCapabilities } = await import(
      '@/lib/orchestrator-leaderboard/global-dataset'
    );

    const caps = await getDatasetCapabilities();
    expect(caps).toEqual(['glm-4.7-flash', 'streamdiffusion-sdxl']);
  });

  it('getGlobalDatasetStats returns stats from config', async () => {
    mockConfigFindUnique.mockResolvedValue({
      lastRefreshedAt: new Date('2025-06-01T00:00:00Z'),
      lastRefreshedBy: 'cron',
      knownCapabilities: ['cap1', 'cap2', 'cap3'],
    });
    mockCount.mockResolvedValue(150);

    const { getGlobalDatasetStats } = await import(
      '@/lib/orchestrator-leaderboard/global-dataset'
    );

    const stats = await getGlobalDatasetStats();
    expect(stats.populated).toBe(true);
    expect(stats.totalOrchestrators).toBe(150);
    expect(stats.capabilityCount).toBe(3);
    expect(stats.refreshedBy).toBe('cron');
  });

  it('getGlobalDatasetStats returns empty when never refreshed', async () => {
    mockConfigFindUnique.mockResolvedValue(null);

    const { getGlobalDatasetStats } = await import(
      '@/lib/orchestrator-leaderboard/global-dataset'
    );

    const stats = await getGlobalDatasetStats();
    expect(stats.populated).toBe(false);
    expect(stats.totalOrchestrators).toBe(0);
  });

  it('writeGlobalDataset filters out empty orchUri rows', async () => {
    const { writeGlobalDataset } = await import(
      '@/lib/orchestrator-leaderboard/global-dataset'
    );

    await writeGlobalDataset({
      capabilities: {
        noop: [
          { orch_uri: 'https://valid.test', gpu_name: 'RTX', gpu_gb: 24, avail: 1, total_cap: 1, price_per_unit: 50, best_lat_ms: null, avg_lat_ms: null, swap_ratio: null, avg_avail: null },
          { orch_uri: '', gpu_name: '', gpu_gb: 0, avail: 0, total_cap: 0, price_per_unit: 0, best_lat_ms: null, avg_lat_ms: null, swap_ratio: null, avg_avail: null },
        ],
      },
      refreshedBy: 'test',
    });

    const createCall = mockCreateMany.mock.calls[0][0];
    expect(createCall.data).toHaveLength(1);
    expect(createCall.data[0].orchUri).toBe('https://valid.test');
  });
});

// ---------------------------------------------------------------------------
// Config Service
// ---------------------------------------------------------------------------

describe('config service', () => {
  beforeEach(async () => {
    vi.resetModules();
    mockConfigUpsert.mockReset();
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
    mockConfigUpsert.mockResolvedValue({
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
    mockConfigUpsert.mockResolvedValue({
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
    expect(mockConfigUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'singleton' },
        update: { refreshIntervalHours: 8 },
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// Plan evaluation reads from DB dataset
// ---------------------------------------------------------------------------

describe('plan evaluation with DB dataset', () => {
  beforeEach(() => {
    vi.resetModules();
    mockFindMany.mockReset();
  });

  it('evaluatePlan uses rows from getRowsForCapability', async () => {
    mockFindMany.mockResolvedValue([
      {
        id: 'r1',
        capability: 'noop',
        orchUri: 'https://global-orch.test',
        gpuName: 'RTX 4090',
        gpuGb: 24,
        avail: 3,
        totalCap: 4,
        pricePerUnit: 100,
        bestLatMs: 50,
        avgLatMs: 80,
        swapRatio: 0.05,
        avgAvail: 3.2,
        refreshedAt: new Date(),
      },
    ]);

    const { getRowsForCapability } = await import(
      '@/lib/orchestrator-leaderboard/global-dataset'
    );
    const { evaluatePlan } = await import(
      '@/lib/orchestrator-leaderboard/ranking'
    );

    const rows = await getRowsForCapability('noop');
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
