/**
 * Orchestrator Leaderboard — Plan Refresh Manager
 *
 * Redis-backed stale-while-revalidate evaluation: GET /plans/:id/results
 * checks Redis (with in-memory fallback) for cached plan results. If stale
 * or missing, evaluates the plan and caches the result.
 *
 * Plan evaluation reads from the global dataset cache first (zero ClickHouse
 * calls when the global dataset is populated). Falls back to direct
 * fetchLeaderboard() if the global dataset is stale or missing.
 *
 * Optional local dev loop: startLocalRefreshLoop() uses setInterval for
 * sub-minute refresh in long-running dev servers (skipped on Vercel).
 */

import type { ClickHouseLeaderboardRow, DiscoveryPlan, OrchestratorRow, PlanResults } from './types';
import { fetchLeaderboard } from './query';
import { evaluatePlan } from './ranking';
import { listEnabledPlans } from './plans';
import { getGlobalDataset } from './global-dataset';
import { leaderboardSwr, planResultCacheKey, type SwrCacheStatus } from './swr';
import { cacheDel } from '@naap/cache';

const REFRESH_INTERVAL_MS = Number(process.env.LEADERBOARD_REFRESH_INTERVAL_MS) || 60_000;

export interface EvaluateAndCacheResult extends PlanResults {
  cacheStatus: SwrCacheStatus;
}

/**
 * Get rows for a capability. Reads from the global dataset cache if
 * available; falls back to fetchLeaderboard() (direct ClickHouse query).
 */
async function getRowsForCapability(
  capability: string,
  authToken: string,
  requestUrl?: string,
  cookieHeader?: string | null,
): Promise<ClickHouseLeaderboardRow[]> {
  const globalDataset = getGlobalDataset();
  if (globalDataset && capability in globalDataset.capabilities) {
    return globalDataset.capabilities[capability];
  }
  const { rows } = await fetchLeaderboard(capability, authToken, requestUrl, cookieHeader);
  return rows;
}

/**
 * Evaluate one plan across all its capabilities, merge results.
 * Reads from the global dataset cache first (in-memory), falls back to
 * fetchLeaderboard() if the global dataset is stale or missing.
 */
async function evaluate(
  plan: DiscoveryPlan,
  authToken: string,
  requestUrl?: string,
  cookieHeader?: string | null,
): Promise<PlanResults> {
  const capabilities: Record<string, OrchestratorRow[]> = {};
  let totalOrchestrators = 0;

  for (const capability of plan.capabilities) {
    try {
      const rows = await getRowsForCapability(capability, authToken, requestUrl, cookieHeader);
      const evaluated = evaluatePlan(rows, plan);
      capabilities[capability] = evaluated;
      totalOrchestrators += evaluated.length;
    } catch (err) {
      console.error(`[leaderboard] Failed to evaluate capability "${capability}":`, err);
      capabilities[capability] = [];
    }
  }

  return {
    planId: plan.id,
    refreshedAt: new Date().toISOString(),
    capabilities,
    meta: {
      totalOrchestrators,
      refreshIntervalMs: REFRESH_INTERVAL_MS,
      cacheAgeMs: 0,
    },
  };
}

/**
 * Lazy evaluation with Redis-backed SWR cache. Returns cached results if
 * fresh, stale data while triggering async background refresh, or blocks
 * on a cold miss to populate cache.
 *
 * Pass `scheduleBackground` wrapping `after()` from route handlers so
 * background refreshes survive the response on Vercel.
 */
export async function evaluateAndCache(
  plan: DiscoveryPlan,
  authToken: string,
  requestUrl?: string,
  cookieHeader?: string | null,
  scheduleBackground?: (work: () => Promise<void>) => void,
): Promise<EvaluateAndCacheResult> {
  const cacheKey = planResultCacheKey(plan.id, plan.updatedAt);
  const label = `plan:${plan.id}`;

  const { data, cache } = await leaderboardSwr<PlanResults>(
    cacheKey,
    () => evaluate(plan, authToken, requestUrl, cookieHeader),
    label,
    scheduleBackground,
  );

  const cacheAgeMs = data.refreshedAt
    ? Date.now() - new Date(data.refreshedAt).getTime()
    : 0;

  return {
    ...data,
    meta: { ...data.meta, cacheAgeMs },
    cacheStatus: cache,
  };
}

/**
 * Bulk refresh all enabled plans. Called by Vercel Cron and startup warm.
 */
export async function refreshAllPlans(
  authToken: string,
  requestUrl?: string,
  cookieHeader?: string | null,
): Promise<{ refreshed: number; failed: number }> {
  const plans = await listEnabledPlans();
  let refreshed = 0;
  let failed = 0;

  for (const plan of plans) {
    try {
      await evaluateAndCache(plan, authToken, requestUrl, cookieHeader);
      refreshed++;
    } catch (err) {
      failed++;
      if (process.env.NODE_ENV === 'development') {
        console.error(`[leaderboard] Failed to refresh plan ${plan.id}:`, err);
      }
    }
  }

  return { refreshed, failed };
}

export function getCachedPlanResults(_planId: string): PlanResults | null {
  // With Redis-backed SWR, synchronous access is no longer available.
  // Callers should use evaluateAndCache() instead.
  return null;
}

const DATA_PREFIX = 'leaderboard-swr';

export async function invalidatePlanCache(planId: string): Promise<void> {
  // Versioned keys (keyed by updatedAt) naturally expire stale versions.
  // For immediate invalidation we delete any known key pattern.
  await cacheDel(`plan-invalidated:${planId}`, { prefix: DATA_PREFIX }).catch(() => {});
}

export async function clearPlanCache(): Promise<void> {
  // With versioned keys, a global dataset refresh naturally obsoletes old
  // plan results because evaluateAndCache re-evaluates on next access.
  // No explicit bulk delete is needed — old keys expire via hardTtlSec.
}

// ---------------------------------------------------------------------------
// Optional local dev refresh loop (not used on Vercel)
// ---------------------------------------------------------------------------

let localInterval: ReturnType<typeof setInterval> | null = null;

export function startLocalRefreshLoop(authToken: string, requestUrl?: string): void {
  if (process.env.VERCEL) return;
  if (localInterval) return;
  localInterval = setInterval(() => {
    refreshAllPlans(authToken, requestUrl).catch((err) => {
      console.error('[leaderboard] Local refresh loop failed:', err);
    });
  }, REFRESH_INTERVAL_MS);
}

export function stopLocalRefreshLoop(): void {
  if (localInterval) {
    clearInterval(localInterval);
    localInterval = null;
  }
}
