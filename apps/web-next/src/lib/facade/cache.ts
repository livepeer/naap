/**
 * Shared in-process TTL cache for facade resolvers.
 *
 * Identical semantics to raw-data.ts: stores the Promise so concurrent
 * callers within a TTL window coalesce onto the same upstream fetch.
 * Deletes the entry on error so the next caller triggers a fresh fetch.
 */

interface CacheEntry<T> {
  expiresAt: number;
  promise: Promise<T>;
}

const memCache = new Map<string, CacheEntry<unknown>>();
const MAX_ENTRIES = 256;

function evict(now: number): void {
  for (const [k, entry] of memCache) {
    if (entry.expiresAt <= now) memCache.delete(k);
  }
  if (memCache.size <= MAX_ENTRIES) return;

  const sorted = [...memCache.entries()].sort((a, b) => a[1].expiresAt - b[1].expiresAt);
  while (sorted.length > 0 && memCache.size > MAX_ENTRIES) {
    const oldest = sorted.shift()!;
    memCache.delete(oldest[0]);
  }
}

const DEBUG_CACHE = process.env.DEBUG_FACADE_CACHE === '1' || process.env.DEBUG_FACADE_CACHE === 'true';

export function cachedFetch<T>(key: string, ttlMs: number, fetcher: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const existing = memCache.get(key) as CacheEntry<T> | undefined;
  if (existing && existing.expiresAt > now) {
    if (DEBUG_CACHE) console.debug(`[facade/cache] HIT  ${key} (expires in ${Math.round((existing.expiresAt - now) / 1000)}s)`);
    return existing.promise;
  }

  if (DEBUG_CACHE) console.debug(`[facade/cache] MISS ${key} — fetching`);
  const promise = fetcher().catch((err) => {
    memCache.delete(key);
    throw err;
  });

  memCache.set(key, { expiresAt: now + ttlMs, promise: promise as Promise<unknown> });
  evict(now);
  return promise;
}

/** Dashboard BFF origin cache — 1 hour; HTTP `s-maxage` on `/api/v1/dashboard/*` matches in seconds. */
const DASHBOARD_ORIGIN_TTL_MS = 60 * 60 * 1000;

/** TTL constants in milliseconds for {@link cachedFetch} — keep in sync with data-fetching-reference.md */
export const TTL = {
  KPI: DASHBOARD_ORIGIN_TTL_MS,
  PIPELINES: DASHBOARD_ORIGIN_TTL_MS,
  PIPELINE_CATALOG: DASHBOARD_ORIGIN_TTL_MS,
  ORCHESTRATORS: DASHBOARD_ORIGIN_TTL_MS,
  GPU_CAPACITY: DASHBOARD_ORIGIN_TTL_MS,
  PRICING: DASHBOARD_ORIGIN_TTL_MS,
  /** Short origin TTL — job list is the most time-sensitive dashboard surface */
  JOB_FEED: 30 * 1000,
  NETWORK_MODELS: DASHBOARD_ORIGIN_TTL_MS,
  /** Shared raw /v1/net/models cache — used by network-models resolver */
  NET_MODELS: DASHBOARD_ORIGIN_TTL_MS,
  /** api.daydream.live /v1/capacity per-model idle container count */
  DAYDREAM_CAPACITY: DASHBOARD_ORIGIN_TTL_MS,
  /** The Graph subgraph protocol/round data — matches dashboard protocol route s-maxage */
  PROTOCOL: DASHBOARD_ORIGIN_TTL_MS,
  /** The Graph subgraph fees/volume data */
  FEES: DASHBOARD_ORIGIN_TTL_MS,
  /** NAAP /v1/net/capacity — warm-orch capacity snapshot; semantically distinct from PRICING */
  NET_CAPACITY: DASHBOARD_ORIGIN_TTL_MS,
} as const;

/**
 * `Cache-Control` for public dashboard BFF JSON routes.
 *
 * - `max-age=60`: browser serves from local HTTP cache for 60s (covers
 *   navigation-back without any network round-trip).
 * - `s-maxage`: Vercel Edge / CDN cache duration (matches {@link TTL} in seconds).
 * - `stale-while-revalidate`: after max-age/s-maxage expires, serve stale
 *   instantly while refreshing in the background (2× s-maxage).
 */
export function dashboardRouteCacheControl(ttlMs: number): string {
  const sMaxAgeSec = Math.floor(ttlMs / 1000);
  const swr = sMaxAgeSec * 2;
  return `public, max-age=60, s-maxage=${sMaxAgeSec}, stale-while-revalidate=${swr}`;
}
