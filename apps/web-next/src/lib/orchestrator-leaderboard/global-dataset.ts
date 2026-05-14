/**
 * Orchestrator Leaderboard — Global Dataset Cache
 *
 * Single in-memory cache holding the full set of orchestrator rows across
 * all capabilities. Populated by the cron refresh endpoint (full replace);
 * read by plan evaluation (in-memory filter, no ClickHouse round-trip).
 *
 * TTL = configured interval * 2, giving a grace period for stale reads
 * before the plan evaluator falls back to direct ClickHouse queries.
 */

import type { ClickHouseLeaderboardRow } from './types';

export interface GlobalDataset {
  capabilities: Record<string, ClickHouseLeaderboardRow[]>;
  refreshedAt: number;
  refreshedBy: string;
  totalOrchestrators: number;
}

let dataset: GlobalDataset | null = null;
let ttlMs: number = 2 * 3_600_000; // default 2h (1h interval * 2)

/**
 * Get the cached global dataset, or null if expired / never populated.
 */
export function getGlobalDataset(): GlobalDataset | null {
  if (!dataset) return null;
  if (Date.now() > dataset.refreshedAt + ttlMs) {
    return null;
  }
  return dataset;
}

/**
 * Full-replace the global dataset cache.
 * @param newDataset - the fresh dataset to store
 * @param intervalMs - the configured refresh interval in ms (TTL = interval * 2)
 */
export function setGlobalDataset(
  newDataset: GlobalDataset,
  intervalMs?: number,
): void {
  dataset = newDataset;
  if (intervalMs !== undefined) {
    ttlMs = intervalMs * 2;
  }
}

/**
 * Check if the current global dataset is fresh relative to the given interval.
 */
export function isGlobalDatasetFresh(intervalMs: number): boolean {
  if (!dataset) return false;
  return Date.now() - dataset.refreshedAt < intervalMs;
}

export function clearGlobalDataset(): void {
  dataset = null;
}

export function getGlobalDatasetStats(): {
  populated: boolean;
  refreshedAt: number | null;
  refreshedBy: string | null;
  totalOrchestrators: number;
  capabilityCount: number;
  ageMs: number | null;
  ttlMs: number;
} {
  if (!dataset) {
    return {
      populated: false,
      refreshedAt: null,
      refreshedBy: null,
      totalOrchestrators: 0,
      capabilityCount: 0,
      ageMs: null,
      ttlMs,
    };
  }
  return {
    populated: true,
    refreshedAt: dataset.refreshedAt,
    refreshedBy: dataset.refreshedBy,
    totalOrchestrators: dataset.totalOrchestrators,
    capabilityCount: Object.keys(dataset.capabilities).length,
    ageMs: Date.now() - dataset.refreshedAt,
    ttlMs,
  };
}
