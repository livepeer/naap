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
  evict(now);
  return promise;
}

/** TTL constants in milliseconds for {@link cachedFetch} — keep in sync with data-fetching-reference.md */
export const TTL = {
  KPI: 180 * 1000,
  PIPELINES: 180 * 1000,
  PIPELINE_CATALOG: 900 * 1000,
  ORCHESTRATORS: 300 * 1000,
  GPU_CAPACITY: 60 * 1000,
  PRICING: 300 * 1000,
  JOB_FEED: 10 * 1000,
  NETWORK_MODELS: 60 * 1000,
  /** Shared raw /v1/net/models cache — used by network-models resolver */
  NET_MODELS: 300 * 1000,
  /** api.daydream.live /v1/capacity per-model idle container count */
  DAYDREAM_CAPACITY: 60 * 1000,
} as const;
