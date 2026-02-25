/**
 * Service Gateway — Response Cache
 *
 * In-memory cache for GET responses with configurable TTL per endpoint.
 * Cache key includes scope to maintain tenant isolation.
 * Max 1000 entries with lazy expiration-based eviction.
 */

const MAX_ENTRIES = 1000;

interface ResponseCacheEntry {
  body: ArrayBuffer;
  status: number;
  headers: Record<string, string>;
  expiresAt: number;
}

const RESPONSE_CACHE = new Map<string, ResponseCacheEntry>();

/**
 * Build a deterministic cache key scoped by tenant, connector, method, path, and body hash.
 */
export function buildCacheKey(
  scopeId: string,
  slug: string,
  method: string,
  path: string,
  body: string | null
): string {
  const bodyPart = body ? simpleHash(body) : 'nobody';
  return `gw:resp:${scopeId}:${slug}:${method}:${path}:${bodyPart}`;
}

function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const chr = str.charCodeAt(i);
    hash = ((hash << 5) - hash + chr) | 0;
  }
  return hash.toString(36);
}

/**
 * Look up a cached response. Returns null if not found or expired.
 */
export function getCachedResponse(key: string): ResponseCacheEntry | null {
  const entry = RESPONSE_CACHE.get(key);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    RESPONSE_CACHE.delete(key);
    return null;
  }
  return entry;
}

/**
 * Store a response in the cache with a TTL in seconds.
 */
export function setCachedResponse(
  key: string,
  entry: Omit<ResponseCacheEntry, 'expiresAt'>,
  ttlSeconds: number
): void {
  if (RESPONSE_CACHE.size >= MAX_ENTRIES) {
    evictExpired();
  }
  // If still at capacity after evicting expired entries, drop the oldest
  if (RESPONSE_CACHE.size >= MAX_ENTRIES) {
    const firstKey = RESPONSE_CACHE.keys().next().value;
    if (firstKey) RESPONSE_CACHE.delete(firstKey);
  }
  RESPONSE_CACHE.set(key, {
    ...entry,
    expiresAt: Date.now() + ttlSeconds * 1000,
  });
}

/**
 * Remove all expired entries from the cache.
 */
function evictExpired(): void {
  const now = Date.now();
  for (const [k, v] of RESPONSE_CACHE) {
    if (v.expiresAt < now) RESPONSE_CACHE.delete(k);
  }
}

/**
 * Invalidate all cached responses for a given connector (called on admin updates).
 */
export function invalidateResponseCache(scopeId: string, slug: string): void {
  const prefix = `gw:resp:${scopeId}:${slug}:`;
  for (const key of RESPONSE_CACHE.keys()) {
    if (key.startsWith(prefix)) RESPONSE_CACHE.delete(key);
  }
}

/**
 * Expose cache size for diagnostics / testing.
 */
export function getResponseCacheSize(): number {
  return RESPONSE_CACHE.size;
}

/**
 * Clear the entire response cache (used in tests).
 */
export function clearResponseCache(): void {
  RESPONSE_CACHE.clear();
}
