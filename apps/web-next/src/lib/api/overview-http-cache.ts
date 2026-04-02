/**
 * HTTP caching for public BFF routes under `/api/v1/network/*`.
 *
 * Network overview handlers use {@link jsonWithOverviewCache} with ~30 minute `max-age` /
 * `s-maxage`. Dashboard routes under `/api/v1/dashboard/*` set `Cache-Control` explicitly
 * per route (see each `route.ts`).
 *
 * Pair `export const revalidate` (seconds) on route modules without search-param variance
 * with a numeric literal so Next.js aligns with CDN/browser caching where used.
 * Route files must assign a **numeric literal** (e.g. `1800`): Next.js rejects imports,
 * member expressions (`OverviewHttpCacheSec.*`), and other non-literal RHS for `revalidate`.
 *
 * Note: In-process TTLs in {@link TTL} / raw-data may still be shorter on the origin;
 * HTTP caching is intentionally looser for edge/browser efficiency.
 */

import { NextResponse } from 'next/server';

/** Browser + shared CDN cache duration for network overview routes (30 minutes). */
export const OVERVIEW_HTTP_CACHE_SEC = 30 * 60;

export const OverviewHttpCacheSec = {
  gpuCapacity: OVERVIEW_HTTP_CACHE_SEC,
  kpi: OVERVIEW_HTTP_CACHE_SEC,
  pipelines: OVERVIEW_HTTP_CACHE_SEC,
  pipelineCatalog: OVERVIEW_HTTP_CACHE_SEC,
  orchestrators: OVERVIEW_HTTP_CACHE_SEC,
  pricing: OVERVIEW_HTTP_CACHE_SEC,
  netCapacity: OVERVIEW_HTTP_CACHE_SEC,
  liveVideo: OVERVIEW_HTTP_CACHE_SEC,
  networkModels: OVERVIEW_HTTP_CACHE_SEC,
  perfByModel: OVERVIEW_HTTP_CACHE_SEC,
  protocol: OVERVIEW_HTTP_CACHE_SEC,
  fees: OVERVIEW_HTTP_CACHE_SEC,
} as const;

/**
 * `public` — overview payloads are not user-specific; URL (incl. query) is the cache key.
 * `stale-while-revalidate` — up to 2× max-age, capped at 1 hour beyond the cache window.
 */
export function overviewCacheControl(maxAgeSec: number): string {
  const swr = Math.min(Math.floor(maxAgeSec * 2), maxAgeSec + 3600);
  return `public, max-age=${maxAgeSec}, s-maxage=${maxAgeSec}, stale-while-revalidate=${swr}`;
}

export function jsonWithOverviewCache<T>(body: T, maxAgeSec: number): NextResponse<T> {
  return NextResponse.json(body, {
    headers: { 'Cache-Control': overviewCacheControl(maxAgeSec) },
  });
}
