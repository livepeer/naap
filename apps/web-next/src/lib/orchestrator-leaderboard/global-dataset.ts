/**
 * Orchestrator Leaderboard — Global Dataset (DB-Persisted)
 *
 * Reads/writes orchestrator rows from the LeaderboardDatasetRow table.
 * Written in bulk during hourly cron refresh; read by /rank, /filters,
 * and plan evaluation. Every serverless instance reads from the same
 * Postgres table — no more cold-start issues.
 */

import { prisma } from '@/lib/db';
import type { ClickHouseLeaderboardRow } from './types';

// ---------------------------------------------------------------------------
// Read helpers
// ---------------------------------------------------------------------------

/**
 * Get all orchestrator rows for a specific capability.
 * Primary read path for /rank and plan evaluation.
 */
export async function getRowsForCapability(
  capability: string,
): Promise<ClickHouseLeaderboardRow[]> {
  const rows = await prisma.leaderboardDatasetRow.findMany({
    where: { capability },
  });

  return rows.map((r) => ({
    orch_uri: r.orchUri,
    gpu_name: r.gpuName,
    gpu_gb: r.gpuGb,
    avail: r.avail,
    total_cap: r.totalCap,
    price_per_unit: r.pricePerUnit,
    best_lat_ms: r.bestLatMs,
    avg_lat_ms: r.avgLatMs,
    swap_ratio: r.swapRatio,
    avg_avail: r.avgAvail,
  }));
}

/**
 * Get distinct capabilities that have at least one orchestrator row.
 * Used by /filters to build the capability dropdown.
 */
export async function getDatasetCapabilities(): Promise<string[]> {
  const result = await prisma.leaderboardDatasetRow.findMany({
    select: { capability: true },
    distinct: ['capability'],
    orderBy: { capability: 'asc' },
  });
  return result.map((r) => r.capability);
}

/**
 * Get dataset statistics for admin introspection.
 */
export async function getGlobalDatasetStats(): Promise<{
  populated: boolean;
  refreshedAt: number | null;
  refreshedBy: string | null;
  totalOrchestrators: number;
  capabilityCount: number;
}> {
  const config = await prisma.leaderboardConfig.findUnique({
    where: { id: 'singleton' },
    select: {
      lastRefreshedAt: true,
      lastRefreshedBy: true,
      knownCapabilities: true,
    },
  });

  if (!config?.lastRefreshedAt) {
    return {
      populated: false,
      refreshedAt: null,
      refreshedBy: null,
      totalOrchestrators: 0,
      capabilityCount: 0,
    };
  }

  const totalOrchestrators = await prisma.leaderboardDatasetRow.count();
  const capabilityCount = config.knownCapabilities.length;

  return {
    populated: totalOrchestrators > 0,
    refreshedAt: config.lastRefreshedAt.getTime(),
    refreshedBy: config.lastRefreshedBy,
    totalOrchestrators,
    capabilityCount,
  };
}

// ---------------------------------------------------------------------------
// Write helpers (used by global-refresh.ts)
// ---------------------------------------------------------------------------

interface DatasetWriteInput {
  capabilities: Record<string, ClickHouseLeaderboardRow[]>;
  refreshedBy: string;
}

/**
 * Full-replace the persistent dataset. Deletes all existing rows and inserts
 * the new resolved dataset in a single transaction.
 */
export async function writeGlobalDataset(input: DatasetWriteInput): Promise<{
  totalRows: number;
  totalCapabilities: number;
}> {
  const { capabilities, refreshedBy } = input;
  const now = new Date();

  const flatRows: {
    capability: string;
    orchUri: string;
    gpuName: string;
    gpuGb: number;
    avail: number;
    totalCap: number;
    pricePerUnit: number;
    bestLatMs: number | null;
    avgLatMs: number | null;
    swapRatio: number | null;
    avgAvail: number | null;
    refreshedAt: Date;
  }[] = [];

  for (const [cap, rows] of Object.entries(capabilities)) {
    for (const row of rows) {
      flatRows.push({
        capability: cap,
        orchUri: row.orch_uri || '',
        gpuName: row.gpu_name || '',
        gpuGb: row.gpu_gb || 0,
        avail: row.avail || 0,
        totalCap: row.total_cap || 0,
        pricePerUnit: row.price_per_unit || 0,
        bestLatMs: row.best_lat_ms ?? null,
        avgLatMs: row.avg_lat_ms ?? null,
        swapRatio: row.swap_ratio ?? null,
        avgAvail: row.avg_avail ?? null,
        refreshedAt: now,
      });
    }
  }

  // Skip empty orchUri rows (invalid data)
  const validRows = flatRows.filter((r) => r.orchUri.length > 0);

  await prisma.$transaction([
    prisma.leaderboardDatasetRow.deleteMany({}),
    prisma.leaderboardDatasetRow.createMany({ data: validRows }),
    prisma.leaderboardConfig.upsert({
      where: { id: 'singleton' },
      update: {
        lastRefreshedAt: now,
        lastRefreshedBy: refreshedBy,
        knownCapabilities: Object.keys(capabilities).sort(),
      },
      create: {
        id: 'singleton',
        lastRefreshedAt: now,
        lastRefreshedBy: refreshedBy,
        knownCapabilities: Object.keys(capabilities).sort(),
      },
    }),
  ]);

  return {
    totalRows: validRows.length,
    totalCapabilities: Object.keys(capabilities).length,
  };
}

// ---------------------------------------------------------------------------
// Legacy compatibility (kept for plan cache invalidation signal)
// ---------------------------------------------------------------------------

export function clearGlobalDataset(): void {
  // No-op: dataset lives in DB, plan cache is managed by refresh.ts
}
