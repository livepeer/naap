/**
 * HTTP caching for public overview BFF routes (`/api/v1/dashboard/*`, `/api/v1/network/*`).
 *
 * Most overview endpoints use **30 minutes** (`max-age` / `s-maxage`): the main dashboard
 * widgets refresh on **1h or longer** intervals, so shorter HTTP caches would only add load.
 *
 * **Exception:** the live job feed (`/api/v1/dashboard/job-feed`) polls as fast as **5s**;
 * use {@link jsonJobFeedResponse} so browsers/CDNs do not cache it (`no-store`).
 *
 * Pair `export const revalidate` (seconds) on route modules without search-param variance
 * with {@link OVERVIEW_HTTP_CACHE_SEC} so Next.js aligns with CDN/browser caching.
 *
 * Note: In-process TTLs in {@link TTL} / raw-data may still be shorter on the origin;
 * HTTP caching is intentionally looser for edge/browser efficiency (except job feed).
 */

import { NextResponse } from 'next/server';

/** Browser + shared CDN cache duration for all overview routes (30 minutes). */
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

/** Live job feed — UI polls every 5s–90s; do not cache at the edge or in the browser. */
export function jsonJobFeedResponse<T>(body: T): NextResponse<T> {
  return NextResponse.json(body, {
    headers: { 'Cache-Control': 'no-store' },
  });
}
