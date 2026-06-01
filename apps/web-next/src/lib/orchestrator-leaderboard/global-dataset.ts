/**
 * Orchestrator Leaderboard — Global Dataset (DB-Persisted)
 *
 * Reads/writes orchestrator rows from the LeaderboardDatasetRow table.
 * Written in bulk during hourly cron refresh; read by /rank, /filters,
 * and plan evaluation. Every serverless instance reads from the same
 * Postgres table — no more cold-start issues.
 */

import { randomUUID } from 'node:crypto';
import { Prisma } from '@naap/database';
import { prisma } from '@/lib/db';
import type { ClickHouseLeaderboardRow } from './types';

const BATCH_SIZE = 500;

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
 * Falls back to knownCapabilities from LeaderboardConfig if the table
 * is empty (e.g. before first cron run after deploy).
 */
export async function getDatasetCapabilities(): Promise<string[]> {
  const result = await prisma.leaderboardDatasetRow.findMany({
    select: { capability: true },
    distinct: ['capability'],
    orderBy: { capability: 'asc' },
  });

  if (result.length > 0) {
    return result.map((r) => r.capability);
  }

  // Fallback: read from LeaderboardConfig.knownCapabilities (populated
  // by previous refresh runs, survives table truncation between deploys)
  try {
    const config = await prisma.leaderboardConfig.findUnique({
      where: { id: 'singleton' },
      select: { knownCapabilities: true },
    });
    return config?.knownCapabilities ?? [];
  } catch {
    return [];
  }
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

interface FlatDatasetRow {
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
}

/**
 * Full-replace the persistent dataset using upsert-then-prune so that
 * concurrent readers always see a populated table:
 *
 *   1. UPSERT every new row with `refreshedAt = now` (ON CONFLICT (capability,
 *      orchUri) DO UPDATE). Existing rows are updated in place; new rows are
 *      inserted.
 *   2. DELETE rows whose `refreshedAt < now` — those are stragglers from the
 *      previous refresh that no longer exist in the new dataset.
 *
 * Unlike the prior delete-then-insert approach, this never leaves the table
 * empty (or partially empty), so `/rank`, `/filters`, and plan evaluation
 * cannot observe zero-row windows during a refresh — even under cold-start
 * triggered refreshes on Vercel.
 */
export async function writeGlobalDataset(input: DatasetWriteInput): Promise<{
  totalRows: number;
  totalCapabilities: number;
}> {
  const { capabilities, refreshedBy } = input;
  const now = new Date();

  const flatRows: FlatDatasetRow[] = [];
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
      });
    }
  }

  const validRows = flatRows.filter((r) => r.orchUri.length > 0);
  const capNames = Object.keys(capabilities).sort();

  await prisma.$transaction(async (tx) => {
    for (let i = 0; i < validRows.length; i += BATCH_SIZE) {
      const batch = validRows.slice(i, i + BATCH_SIZE);
      await upsertDatasetBatch(tx, batch, now);
    }

    // Prune rows that weren't refreshed in this run — they're no longer in
    // the resolved dataset. Doing this after the upserts means readers never
    // see a moment where the table is empty.
    await tx.leaderboardDatasetRow.deleteMany({
      where: { refreshedAt: { lt: now } },
    });

    await tx.leaderboardConfig.upsert({
      where: { id: 'singleton' },
      update: {
        lastRefreshedAt: now,
        lastRefreshedBy: refreshedBy,
        knownCapabilities: capNames,
      },
      create: {
        id: 'singleton',
        lastRefreshedAt: now,
        lastRefreshedBy: refreshedBy,
        knownCapabilities: capNames,
      },
    });
  });

  return {
    totalRows: validRows.length,
    totalCapabilities: capNames.length,
  };
}

async function upsertDatasetBatch(
  tx: Prisma.TransactionClient,
  batch: FlatDatasetRow[],
  refreshedAt: Date,
): Promise<void> {
  if (batch.length === 0) return;

  const valuesSql = Prisma.join(
    batch.map(
      (r) => Prisma.sql`(
        ${randomUUID()},
        ${r.capability},
        ${r.orchUri},
        ${r.gpuName},
        ${r.gpuGb},
        ${r.avail},
        ${r.totalCap},
        ${r.pricePerUnit},
        ${r.bestLatMs},
        ${r.avgLatMs},
        ${r.swapRatio},
        ${r.avgAvail},
        ${refreshedAt}
      )`,
    ),
  );

  await tx.$executeRaw(Prisma.sql`
    INSERT INTO "plugin_orchestrator_leaderboard"."LeaderboardDatasetRow"
      (id, capability, "orchUri", "gpuName", "gpuGb", avail, "totalCap",
       "pricePerUnit", "bestLatMs", "avgLatMs", "swapRatio", "avgAvail",
       "refreshedAt")
    VALUES ${valuesSql}
    ON CONFLICT (capability, "orchUri") DO UPDATE SET
      "gpuName"     = EXCLUDED."gpuName",
      "gpuGb"       = EXCLUDED."gpuGb",
      avail         = EXCLUDED.avail,
      "totalCap"    = EXCLUDED."totalCap",
      "pricePerUnit" = EXCLUDED."pricePerUnit",
      "bestLatMs"   = EXCLUDED."bestLatMs",
      "avgLatMs"    = EXCLUDED."avgLatMs",
      "swapRatio"   = EXCLUDED."swapRatio",
      "avgAvail"    = EXCLUDED."avgAvail",
      "refreshedAt" = EXCLUDED."refreshedAt"
  `);
}

// ---------------------------------------------------------------------------
// Legacy compatibility (kept for plan cache invalidation signal)
// ---------------------------------------------------------------------------

export function clearGlobalDataset(): void {
  // No-op: dataset lives in DB, plan cache is managed by refresh.ts
}
