/**
 * Orchestrator Leaderboard — Plan Refresh Manager
 *
 * Lazy evaluation: GET /plans/:id/results checks the in-memory plan cache;
 * if stale or missing, evaluates the plan and caches the result.
 *
 * Proactive warming: POST /plans/refresh (Vercel Cron) bulk-evaluates all
 * enabled plans so most reads are cache hits.
 *
 * Optional local dev loop: startLocalRefreshLoop() uses setInterval for
 * sub-minute refresh in long-running dev servers (skipped on Vercel).
 */

import type { DiscoveryPlan, OrchestratorRow, PlanResults } from './types';
import { fetchLeaderboard } from './query';
import { evaluatePlan } from './ranking';
import { listEnabledPlans } from './plans';

const REFRESH_INTERVAL_MS = Number(process.env.LEADERBOARD_REFRESH_INTERVAL_MS) || 60_000;
const CACHE_TTL_MS = REFRESH_INTERVAL_MS * 2;

interface PlanCacheEntry {
  results: PlanResults;
  cachedAt: number;
  expiresAt: number;
}

const planCache = new Map<string, PlanCacheEntry>();

function isFresh(entry: PlanCacheEntry): boolean {
  return Date.now() - entry.cachedAt < REFRESH_INTERVAL_MS;
}

function isValid(entry: PlanCacheEntry): boolean {
  return entry.expiresAt > Date.now();
}

/**
 * Evaluate one plan across all its capabilities, merge results.
 * Uses the existing fetchLeaderboard() which has its own 10s in-memory cache.
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
      const { rows } = await fetchLeaderboard(capability, authToken, requestUrl, cookieHeader);
      const evaluated = evaluatePlan(rows, plan);
      capabilities[capability] = evaluated;
      totalOrchestrators += evaluated.length;
    } catch {
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
 * Lazy evaluation with cache. Returns cached results if fresh, otherwise
 * evaluates and caches. Stale-while-revalidate: returns stale data while
 * triggering async refresh if within TTL but past refresh interval.
 */
export async function evaluateAndCache(
  plan: DiscoveryPlan,
  authToken: string,
  requestUrl?: string,
  cookieHeader?: string | null,
): Promise<PlanResults> {
  const entry = planCache.get(plan.id);

  if (entry && isFresh(entry)) {
    return {
      ...entry.results,
      meta: { ...entry.results.meta, cacheAgeMs: Date.now() - entry.cachedAt },
    };
  }

  if (entry && isValid(entry)) {
    void refreshSingle(plan, authToken, requestUrl, cookieHeader);
    return {
      ...entry.results,
      meta: { ...entry.results.meta, cacheAgeMs: Date.now() - entry.cachedAt },
    };
  }

  return refreshSingle(plan, authToken, requestUrl, cookieHeader);
}

async function refreshSingle(
  plan: DiscoveryPlan,
  authToken: string,
  requestUrl?: string,
  cookieHeader?: string | null,
): Promise<PlanResults> {
  const results = await evaluate(plan, authToken, requestUrl, cookieHeader);
  const now = Date.now();
  planCache.set(plan.id, {
    results,
    cachedAt: now,
    expiresAt: now + CACHE_TTL_MS,
  });
  return results;
}

/**
 * Bulk refresh all enabled plans. Called by Vercel Cron.
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
      await refreshSingle(plan, authToken, requestUrl, cookieHeader);
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

export function getCachedPlanResults(planId: string): PlanResults | null {
  const entry = planCache.get(planId);
  if (!entry || !isValid(entry)) return null;
  return {
    ...entry.results,
    meta: { ...entry.results.meta, cacheAgeMs: Date.now() - entry.cachedAt },
  };
}

export function invalidatePlanCache(planId: string): void {
  planCache.delete(planId);
}

export function clearPlanCache(): void {
  planCache.clear();
}

// ---------------------------------------------------------------------------
// Optional local dev refresh loop (not used on Vercel)
// ---------------------------------------------------------------------------

let localInterval: ReturnType<typeof setInterval> | null = null;

export function startLocalRefreshLoop(authToken: string, requestUrl?: string): void {
  if (process.env.VERCEL) return;
  if (localInterval) return;
  localInterval = setInterval(() => {
    void refreshAllPlans(authToken, requestUrl);
  }, REFRESH_INTERVAL_MS);
}

export function stopLocalRefreshLoop(): void {
  if (localInterval) {
    clearInterval(localInterval);
    localInterval = null;
  }
}
