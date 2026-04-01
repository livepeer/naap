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

export function cachedFetch<T>(key: string, ttlMs: number, fetcher: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const existing = memCache.get(key) as CacheEntry<T> | undefined;
  if (existing && existing.expiresAt > now) {
    console.log(`[facade/cache] HIT  ${key} (expires in ${Math.round((existing.expiresAt - now) / 1000)}s)`);
    return existing.promise;
  }

  console.log(`[facade/cache] MISS ${key} — fetching`);
  const promise = fetcher().catch((err) => {
    memCache.delete(key);
    throw err;
  });

  memCache.set(key, { expiresAt: now + ttlMs, promise: promise as Promise<unknown> });
  return promise;
}

/** TTL constants (seconds) — keep in sync with data-fetching-reference.md */
export const TTL = {
  KPI: 180,
  PIPELINES: 180,
  PIPELINE_CATALOG: 900,
  ORCHESTRATORS: 300,
  GPU_CAPACITY: 60,
  PRICING: 300,
  JOB_FEED: 10,
  NETWORK_MODELS: 60,
  /** Shared raw /v1/net/models cache — used by network-models resolver */
  NET_MODELS: 300,
  /** api.daydream.live /v1/capacity per-model idle container count */
  DAYDREAM_CAPACITY: 60,
} as const;
