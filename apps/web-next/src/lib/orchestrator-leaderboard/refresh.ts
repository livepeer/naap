/**
 * Orchestrator Leaderboard — Plan Refresh Manager
 *
 * Lazy evaluation: GET /plans/:id/results checks the in-memory plan cache;
 * if stale or missing, evaluates the plan and caches the result.
 *
 * Plan evaluation reads from the persistent LeaderboardDatasetRow table
 * (populated by cron refresh). The plan result cache is in-memory (fine
 * for serverless — it's a computed derivative, not source of truth).
 *
 * Optional local dev loop: startLocalRefreshLoop() uses setInterval for
 * sub-minute refresh in long-running dev servers (skipped on Vercel).
 */

import type { DiscoveryPlan, OrchestratorRow, PlanResults } from './types';
import { evaluatePlan } from './ranking';
import { listEnabledPlans } from './plans';
import { getRowsForCapability } from './global-dataset';
import {
  fingerprintCapabilityList,
  syncPymthouseManifestSnapshot,
} from '@/lib/pymthouse-manifest';
import {
  providerRestrictionRevision,
  resolvePlanCapabilitiesForProvider,
} from './provider-restrictions';

const REFRESH_INTERVAL_MS = Number(process.env.LEADERBOARD_REFRESH_INTERVAL_MS) || 60_000;
const CACHE_TTL_MS = REFRESH_INTERVAL_MS * 2;

const PLAN_CACHE_KEY_SEP = '\0';

/** Composite key: plan id, billing provider, allowlist revision (PymtHouse), capability-set fingerprint. */
export function buildPlanEvaluationCacheKey(plan: DiscoveryPlan): string {
  const slug = plan.billingProviderSlug ?? 'null';
  const rev = providerRestrictionRevision(plan.billingProviderSlug);
  const capFp = fingerprintCapabilityList(plan.capabilities);
  return `${plan.id}${PLAN_CACHE_KEY_SEP}${slug}${PLAN_CACHE_KEY_SEP}${rev}${PLAN_CACHE_KEY_SEP}${capFp}`;
}

interface PlanCacheEntry {
  results: PlanResults;
  cachedAt: number;
  expiresAt: number;
}

const planCache = new Map<string, PlanCacheEntry>();

function queryCapabilityName(capability: string): string {
  const trimmed = capability.trim();
  const slash = trimmed.lastIndexOf('/');
  return slash >= 0 ? trimmed.slice(slash + 1).trim() : trimmed;
}

function isFresh(entry: PlanCacheEntry): boolean {
  return Date.now() - entry.cachedAt < REFRESH_INTERVAL_MS;
}

function isValid(entry: PlanCacheEntry): boolean {
  return entry.expiresAt > Date.now();
}

/**
 * Evaluate one plan across all its capabilities, merge results.
 * Reads from the persistent DB dataset table.
 */
async function evaluate(plan: DiscoveryPlan): Promise<PlanResults> {
  const capabilities: Record<string, OrchestratorRow[]> = {};
  let totalOrchestrators = 0;

  for (const capability of plan.capabilities) {
    try {
      const rows = await getRowsForCapability(queryCapabilityName(capability));
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
  const cacheKey = buildPlanEvaluationCacheKey(plan);
  const entry = planCache.get(cacheKey);

  if (entry && isFresh(entry)) {
    return {
      ...entry.results,
      meta: { ...entry.results.meta, cacheAgeMs: Date.now() - entry.cachedAt },
    };
  }

  if (entry && isValid(entry)) {
    refreshSingle(plan).catch((err) => {
      console.error(`[leaderboard] Background refresh failed for plan ${plan.id}:`, err);
    });
    return {
      ...entry.results,
      meta: { ...entry.results.meta, cacheAgeMs: Date.now() - entry.cachedAt },
    };
  }

  return refreshSingle(plan);
}

async function refreshSingle(plan: DiscoveryPlan): Promise<PlanResults> {
  const results = await evaluate(plan);
  const now = Date.now();
  const cacheKey = buildPlanEvaluationCacheKey(plan);
  planCache.set(cacheKey, {
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
  authToken?: string,
  requestUrl?: string,
  cookieHeader?: string | null,
): Promise<{ refreshed: number; failed: number }> {
  await syncPymthouseManifestSnapshot();
  const plans = await listEnabledPlans();
  let refreshed = 0;
  let failed = 0;

  for (const plan of plans) {
    try {
      const planForEval = {
        ...plan,
        capabilities: resolvePlanCapabilitiesForProvider(plan),
      };
      await refreshSingle(planForEval);
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
  const prefix = `${planId}${PLAN_CACHE_KEY_SEP}`;
  for (const [key, entry] of planCache) {
    if (!key.startsWith(prefix)) continue;
    if (!isValid(entry)) continue;
    return {
      ...entry.results,
      meta: { ...entry.results.meta, cacheAgeMs: Date.now() - entry.cachedAt },
    };
  }
  return null;
}

export function invalidatePlanCache(planId: string): void {
  const prefix = `${planId}${PLAN_CACHE_KEY_SEP}`;
  for (const key of [...planCache.keys()]) {
    if (key.startsWith(prefix)) {
      planCache.delete(key);
    }
  }
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
    refreshAllPlans().catch((err) => {
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
