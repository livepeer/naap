/**
 * Orchestrator Leaderboard — In-Memory Result Cache
 *
 * Caches parsed ClickHouse rows keyed by capability name. ClickHouse data
 * updates every 5-10s, so repeated SDK calls for the same capability within
 * that window are served from cache. The full result set (up to 100 rows) is
 * cached so that different topN / filters / slaWeights requests share one
 * cached ClickHouse query.
 */

import type { CacheEntry, ClickHouseLeaderboardRow } from './types';

const DEFAULT_TTL_MS = 10_000;
const MAX_ENTRIES = 50;

const LEADERBOARD_CACHE = new Map<string, CacheEntry<ClickHouseLeaderboardRow[]>>();

let stats = { hits: 0, misses: 0 };

export function getCached(capability: string): { rows: ClickHouseLeaderboardRow[]; cachedAt: number } | null {
  const entry = LEADERBOARD_CACHE.get(capability);
  if (!entry) {
    stats.misses++;
    return null;
  }
  if (entry.expiresAt < Date.now()) {
    LEADERBOARD_CACHE.delete(capability);
    stats.misses++;
    return null;
  }
  stats.hits++;
  return { rows: entry.data, cachedAt: entry.cachedAt };
}

export function setCached(
  capability: string,
  rows: ClickHouseLeaderboardRow[],
  ttlMs: number = DEFAULT_TTL_MS
): void {
  if (LEADERBOARD_CACHE.size >= MAX_ENTRIES) {
    evictExpired();
  }
  if (LEADERBOARD_CACHE.size >= MAX_ENTRIES) {
    const oldest = LEADERBOARD_CACHE.keys().next().value;
    if (oldest) LEADERBOARD_CACHE.delete(oldest);
  }
  const now = Date.now();
  LEADERBOARD_CACHE.set(capability, {
    data: rows,
    cachedAt: now,
    expiresAt: now + ttlMs,
  });
}

function evictExpired(): void {
  const now = Date.now();
  for (const [k, v] of LEADERBOARD_CACHE) {
    if (v.expiresAt < now) LEADERBOARD_CACHE.delete(k);
  }
}

export function clearCache(): void {
  LEADERBOARD_CACHE.clear();
  stats = { hits: 0, misses: 0 };
}

export function getCacheStats(): { size: number; hits: number; misses: number } {
  return { size: LEADERBOARD_CACHE.size, ...stats };
}
