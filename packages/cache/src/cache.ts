/**
 * Cache Layer
 *
 * Provides caching utilities with Redis backend and in-memory fallback.
 * Automatically falls back to in-memory cache when Redis is unavailable.
 */

import { getRedis, isRedisConnected } from './redis.js';

export interface CacheOptions {
  /** Time to live in seconds (default: 300 = 5 minutes) */
  ttl?: number;
  /** Cache key prefix (default: 'cache') */
  prefix?: string;
}

/**
 * In-memory cache fallback
 */
interface MemoryCacheEntry {
  value: string;
  expiresAt: number;
}

const memoryCache = new Map<string, MemoryCacheEntry>();

// Clean up expired entries every minute
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of memoryCache.entries()) {
    if (entry.expiresAt < now) {
      memoryCache.delete(key);
    }
  }
}, 60000);

/**
 * Build cache key with prefix
 */
function buildKey(key: string, prefix: string): string {
  return `${prefix}:${key}`;
}

/**
 * Get value from cache
 */
export async function cacheGet<T>(key: string, options: CacheOptions = {}): Promise<T | null> {
  const { prefix = 'cache' } = options;
  const cacheKey = buildKey(key, prefix);

  // Try Redis first
  const redis = getRedis();
  if (redis && isRedisConnected()) {
    try {
      const data = await redis.get(cacheKey);
      if (data) {
        return JSON.parse(data) as T;
      }
      return null;
    } catch (err) {
      console.warn('[Cache] Redis get failed, trying memory:', err);
    }
  }

  // Fallback to memory cache
  const entry = memoryCache.get(cacheKey);
  if (entry && entry.expiresAt > Date.now()) {
    return JSON.parse(entry.value) as T;
  }

  return null;
}

/**
 * Set value in cache
 */
export async function cacheSet<T>(
  key: string,
  value: T,
  options: CacheOptions = {}
): Promise<void> {
  const { ttl = 300, prefix = 'cache' } = options;
  const cacheKey = buildKey(key, prefix);
  const serialized = JSON.stringify(value);

  // Try Redis first
  const redis = getRedis();
  if (redis && isRedisConnected()) {
    try {
      await redis.setex(cacheKey, ttl, serialized);
      return;
    } catch (err) {
      console.warn('[Cache] Redis set failed, using memory:', err);
    }
  }

  // Fallback to memory cache
  memoryCache.set(cacheKey, {
    value: serialized,
    expiresAt: Date.now() + ttl * 1000,
  });
}

/**
 * Delete value from cache
 */
export async function cacheDel(key: string, options: CacheOptions = {}): Promise<void> {
  const { prefix = 'cache' } = options;
  const cacheKey = buildKey(key, prefix);

  // Delete from Redis
  const redis = getRedis();
  if (redis && isRedisConnected()) {
    try {
      await redis.del(cacheKey);
    } catch (err) {
      console.warn('[Cache] Redis del failed:', err);
    }
  }

  // Also delete from memory cache
  memoryCache.delete(cacheKey);
}

/**
 * Get or set cache value
 * If not in cache, calls fetcher and caches the result
 */
export async function cacheGetOrSet<T>(
  key: string,
  fetcher: () => Promise<T>,
  options: CacheOptions = {}
): Promise<T> {
  // Try to get from cache first
  const cached = await cacheGet<T>(key, options);
  if (cached !== null) {
    return cached;
  }

  // Fetch fresh data
  const data = await fetcher();

  // Cache the result (don't await to not block response)
  cacheSet(key, data, options).catch((err) => {
    console.warn('[Cache] Failed to cache result:', err);
  });

  return data;
}

/**
 * Invalidate cache by pattern
 */
export async function cacheInvalidate(pattern: string, options: CacheOptions = {}): Promise<number> {
  const { prefix = 'cache' } = options;
  const fullPattern = buildKey(pattern, prefix);
  let count = 0;

  // Delete from Redis
  const redis = getRedis();
  if (redis && isRedisConnected()) {
    try {
      const keys = await redis.keys(fullPattern);
      if (keys.length > 0) {
        count = await redis.del(...keys);
      }
    } catch (err) {
      console.warn('[Cache] Redis invalidate failed:', err);
    }
  }

  // Also delete from memory cache
  const regex = new RegExp('^' + fullPattern.replace(/\*/g, '.*') + '$');
  for (const key of memoryCache.keys()) {
    if (regex.test(key)) {
      memoryCache.delete(key);
      count++;
    }
  }

  return count;
}

/**
 * Invalidate all caches for a team
 */
export async function cacheInvalidateTeam(teamId: string): Promise<void> {
  await cacheInvalidate(`team:${teamId}:*`);
}

/**
 * Invalidate all caches for a user
 */
export async function cacheInvalidateUser(userId: string): Promise<void> {
  await cacheInvalidate(`user:${userId}:*`);
}

/**
 * Clear all cache (use with caution)
 */
export async function cacheClear(): Promise<void> {
  // Clear Redis
  const redis = getRedis();
  if (redis && isRedisConnected()) {
    try {
      const keys = await redis.keys('cache:*');
      if (keys.length > 0) {
        await redis.del(...keys);
      }
    } catch (err) {
      console.warn('[Cache] Redis clear failed:', err);
    }
  }

  // Clear memory cache
  memoryCache.clear();
}

/**
 * Get cache statistics
 */
export function getCacheStats(): {
  backend: 'redis' | 'memory';
  memorySize: number;
  redisConnected: boolean;
} {
  return {
    backend: isRedisConnected() ? 'redis' : 'memory',
    memorySize: memoryCache.size,
    redisConnected: isRedisConnected(),
  };
}
