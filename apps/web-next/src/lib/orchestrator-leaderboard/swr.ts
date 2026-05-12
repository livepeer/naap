/**
 * Orchestrator Leaderboard — Redis-backed SWR Cache
 *
 * Provides stale-while-revalidate caching for leaderboard data using the
 * same @naap/cache infrastructure as the BFF dashboard routes. Isolated
 * under `leaderboard-swr:*` / `leaderboard-swr-lock:*` prefixes.
 *
 * Two env-tunable TTL sets mirror the BFF pattern:
 *   LEADERBOARD_SWR_SOFT_SEC  – fresh window (default 60s)
 *   LEADERBOARD_SWR_HARD_SEC  – max stale retention (default 7200s / 2h)
 *   LEADERBOARD_SWR_LOCK_SEC  – distributed lock TTL (default 60s)
 */

import { staleWhileRevalidate, cacheGet, cacheSet, cacheDel, type SwrResult, type SwrCacheStatus } from '@naap/cache';

export type { SwrResult, SwrCacheStatus };

const DATA_PREFIX = 'leaderboard-swr';
const LOCK_PREFIX = 'leaderboard-swr-lock';
const DATASET_KEY = 'leaderboard-global-dataset';

export function readLeaderboardSwrEnv(): {
  softTtlSec: number;
  hardTtlSec: number;
  lockTtlSec: number;
} {
  const softTtlSec = Math.max(5, parseInt(process.env.LEADERBOARD_SWR_SOFT_SEC ?? '60', 10) || 60);
  const hardTtlSec = Math.max(
    softTtlSec + 1,
    parseInt(process.env.LEADERBOARD_SWR_HARD_SEC ?? '7200', 10) || 7200,
  );
  const lockTtlSec = Math.max(10, parseInt(process.env.LEADERBOARD_SWR_LOCK_SEC ?? '60', 10) || 60);
  return { softTtlSec, hardTtlSec, lockTtlSec };
}

/**
 * Redis-backed SWR for leaderboard data. Works identically to
 * bffStaleWhileRevalidate but uses leaderboard-specific prefixes and TTLs.
 *
 * When called from a Next.js route handler, pass `scheduleBackground`
 * wrapping `after()` from `next/server` so background refreshes survive
 * the response. For non-route contexts (startup warm, cron), omit it
 * and the default fire-and-forget scheduler is used.
 */
export async function leaderboardSwr<T>(
  cacheKey: string,
  fetcher: () => Promise<T>,
  label: string,
  scheduleBackground?: (work: () => Promise<void>) => void,
): Promise<SwrResult<T>> {
  const { softTtlSec, hardTtlSec, lockTtlSec } = readLeaderboardSwrEnv();
  return staleWhileRevalidate(fetcher, {
    key: cacheKey,
    softTtlSec,
    hardTtlSec,
    lockTtlSec,
    dataPrefix: DATA_PREFIX,
    lockPrefix: LOCK_PREFIX,
    scheduleBackground,
    label,
  });
}

// ---------------------------------------------------------------------------
// Global dataset persistence helpers
// ---------------------------------------------------------------------------

export async function persistDatasetToCache<T>(dataset: T): Promise<void> {
  const { hardTtlSec } = readLeaderboardSwrEnv();
  await cacheSet(DATASET_KEY, dataset, { prefix: DATA_PREFIX, ttl: hardTtlSec });
}

export async function loadDatasetFromCache<T>(): Promise<T | null> {
  return cacheGet<T>(DATASET_KEY, { prefix: DATA_PREFIX });
}

// ---------------------------------------------------------------------------
// Plan result cache key helpers
// ---------------------------------------------------------------------------

export function planResultCacheKey(planId: string, updatedAt: string): string {
  return `discovery-plan-results:${planId}:${updatedAt}`;
}

export async function invalidatePlanResultCache(planId: string): Promise<void> {
  await cacheDel(`plan-invalidated:${planId}`, { prefix: DATA_PREFIX }).catch(() => {});
}
