/**
 * Orchestrator Leaderboard — Startup Warmup
 *
 * Called from Next.js instrumentation (register()) to populate both the
 * global leaderboard dataset and per-plan result caches in Redis/memory
 * before the first user request arrives.
 *
 * Order:
 *   1. Hydrate global dataset from Redis (fast, cross-instance).
 *   2. If missing/stale, run a full refreshGlobalDataset() from sources.
 *   3. List all enabled discovery plans and warm their result caches.
 *
 * All steps are non-fatal — failures log warnings but never crash startup.
 *
 * Gated by LEADERBOARD_STARTUP_WARM_ENABLED (default: 'true'). Set to
 * 'false' to disable warm on startup (e.g. for fast local dev restarts).
 */

import { hydrateGlobalDatasetFromCache, isGlobalDatasetFresh } from './global-dataset';
import { refreshGlobalDataset } from './global-refresh';
import { refreshAllPlans } from './refresh';
import { getRefreshIntervalMs } from './config';

function resolveStartupOrigin(): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : undefined) ||
    'http://localhost:3000'
  );
}

function resolveWarmAuthToken(): string {
  return process.env.LEADERBOARD_WARM_AUTH_TOKEN || process.env.CRON_SECRET || '';
}

export async function warmOrchestratorLeaderboard(): Promise<{
  datasetHydrated: boolean;
  datasetRefreshed: boolean;
  plansRefreshed: number;
  plansFailed: number;
}> {
  const result = {
    datasetHydrated: false,
    datasetRefreshed: false,
    plansRefreshed: 0,
    plansFailed: 0,
  };

  const authToken = resolveWarmAuthToken();
  const origin = resolveStartupOrigin();

  // 1. Try hydrating the global dataset from Redis
  try {
    result.datasetHydrated = await hydrateGlobalDatasetFromCache();
    if (result.datasetHydrated) {
      console.log('[leaderboard] Global dataset hydrated from Redis cache');
    }
  } catch (err) {
    console.warn('[leaderboard] Dataset hydration failed (non-fatal):', err);
  }

  // 2. If not hydrated or stale, do a full refresh from sources
  if (!result.datasetHydrated) {
    try {
      const intervalMs = await getRefreshIntervalMs();
      if (!isGlobalDatasetFresh(intervalMs)) {
        const refreshResult = await refreshGlobalDataset('startup', authToken, origin);
        result.datasetRefreshed = refreshResult.refreshed;
        console.log(
          `[leaderboard] Global dataset refreshed on startup: ${refreshResult.capabilities} capabilities, ${refreshResult.orchestrators} orchestrators`,
        );
      }
    } catch (err) {
      console.warn('[leaderboard] Dataset refresh on startup failed (non-fatal):', err);
    }
  }

  // 3. Warm all enabled plan result caches
  try {
    const planResult = await refreshAllPlans(authToken, origin);
    result.plansRefreshed = planResult.refreshed;
    result.plansFailed = planResult.failed;
    console.log(
      `[leaderboard] Plan results warmed on startup: ${planResult.refreshed} ok, ${planResult.failed} failed`,
    );
  } catch (err) {
    console.warn('[leaderboard] Plan warm on startup failed (non-fatal):', err);
  }

  return result;
}
