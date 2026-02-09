/**
 * Distributed Rate Limiter
 *
 * Uses Redis for distributed rate limiting with in-memory fallback.
 * Implements sliding window algorithm for accurate rate limiting.
 */

import { getRedis, isRedisConnected } from './redis.js';

export interface RateLimitConfig {
  /** Maximum number of requests allowed in the window */
  points: number;
  /** Window duration in seconds */
  duration: number;
  /** Block duration in seconds when limit exceeded (default: same as duration) */
  blockDuration?: number;
  /** Key prefix for this limiter */
  keyPrefix?: string;
}

export interface RateLimitResult {
  /** Whether the request is allowed */
  allowed: boolean;
  /** Remaining points in current window */
  remaining: number;
  /** Total points limit */
  limit: number;
  /** Seconds until reset */
  resetIn: number;
  /** Retry after seconds (only if blocked) */
  retryAfter?: number;
}

/**
 * In-memory rate limit store (fallback)
 */
interface MemoryRateLimitEntry {
  count: number;
  resetAt: number;
  blockedUntil?: number;
}

const memoryStore = new Map<string, MemoryRateLimitEntry>();

// Clean up expired entries every minute
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of memoryStore.entries()) {
    if (entry.resetAt < now && (!entry.blockedUntil || entry.blockedUntil < now)) {
      memoryStore.delete(key);
    }
  }
}, 60000);

/**
 * Create a rate limiter with the given configuration
 */
export function createRateLimiter(config: RateLimitConfig) {
  const {
    points,
    duration,
    blockDuration = duration,
    keyPrefix = 'rl',
  } = config;

  /**
   * Consume a point from the rate limiter
   */
  async function consume(key: string, consumePoints: number = 1): Promise<RateLimitResult> {
    const fullKey = `${keyPrefix}:${key}`;
    const now = Date.now();
    const nowSeconds = Math.floor(now / 1000);

    // Try Redis first
    const redis = getRedis();
    if (redis && isRedisConnected()) {
      try {
        return await consumeRedis(redis, fullKey, consumePoints, nowSeconds);
      } catch (err) {
        console.warn('[RateLimiter] Redis consume failed, using memory:', err);
      }
    }

    // Fallback to memory
    return consumeMemory(fullKey, consumePoints, now);
  }

  /**
   * Redis-based rate limiting using sorted sets
   */
  async function consumeRedis(
    redis: ReturnType<typeof getRedis>,
    key: string,
    consumePoints: number,
    nowSeconds: number
  ): Promise<RateLimitResult> {
    if (!redis) throw new Error('Redis not available');

    const blockKey = `${key}:block`;
    const windowStart = nowSeconds - duration;

    // Check if blocked
    const blockedUntil = await redis.get(blockKey);
    if (blockedUntil && parseInt(blockedUntil) > nowSeconds) {
      const retryAfter = parseInt(blockedUntil) - nowSeconds;
      return {
        allowed: false,
        remaining: 0,
        limit: points,
        resetIn: retryAfter,
        retryAfter,
      };
    }

    // Use Lua script for atomic operations
    const luaScript = `
      local key = KEYS[1]
      local blockKey = KEYS[2]
      local now = tonumber(ARGV[1])
      local windowStart = tonumber(ARGV[2])
      local points = tonumber(ARGV[3])
      local duration = tonumber(ARGV[4])
      local blockDuration = tonumber(ARGV[5])
      local consumePoints = tonumber(ARGV[6])

      -- Remove old entries
      redis.call('ZREMRANGEBYSCORE', key, 0, windowStart)

      -- Get current count
      local current = redis.call('ZCARD', key)

      if current + consumePoints > points then
        -- Rate limited - set block
        redis.call('SETEX', blockKey, blockDuration, now + blockDuration)
        return {0, 0, blockDuration}
      end

      -- Add new entries
      for i = 1, consumePoints do
        redis.call('ZADD', key, now, now .. ':' .. i .. ':' .. math.random())
      end

      -- Set expiry
      redis.call('EXPIRE', key, duration)

      local remaining = points - current - consumePoints
      return {1, remaining, duration}
    `;

    const result = await redis.eval(
      luaScript,
      2,
      key,
      blockKey,
      nowSeconds,
      windowStart,
      points,
      duration,
      blockDuration,
      consumePoints
    ) as [number, number, number];

    const [allowed, remaining, resetIn] = result;

    if (allowed === 0) {
      return {
        allowed: false,
        remaining: 0,
        limit: points,
        resetIn: resetIn,
        retryAfter: resetIn,
      };
    }

    return {
      allowed: true,
      remaining: remaining,
      limit: points,
      resetIn: resetIn,
    };
  }

  /**
   * Memory-based rate limiting (fallback)
   */
  function consumeMemory(key: string, consumePoints: number, now: number): RateLimitResult {
    let entry = memoryStore.get(key);

    // Check if blocked
    if (entry?.blockedUntil && entry.blockedUntil > now) {
      const retryAfter = Math.ceil((entry.blockedUntil - now) / 1000);
      return {
        allowed: false,
        remaining: 0,
        limit: points,
        resetIn: retryAfter,
        retryAfter,
      };
    }

    // Check if window expired
    if (!entry || entry.resetAt < now) {
      entry = {
        count: 0,
        resetAt: now + duration * 1000,
      };
      memoryStore.set(key, entry);
    }

    // Check rate limit
    if (entry.count + consumePoints > points) {
      entry.blockedUntil = now + blockDuration * 1000;
      const retryAfter = Math.ceil(blockDuration);
      return {
        allowed: false,
        remaining: 0,
        limit: points,
        resetIn: retryAfter,
        retryAfter,
      };
    }

    // Consume points
    entry.count += consumePoints;
    const remaining = points - entry.count;
    const resetIn = Math.ceil((entry.resetAt - now) / 1000);

    return {
      allowed: true,
      remaining,
      limit: points,
      resetIn,
    };
  }

  /**
   * Get current rate limit status without consuming
   */
  async function get(key: string): Promise<RateLimitResult> {
    const fullKey = `${keyPrefix}:${key}`;
    const now = Date.now();

    // Check memory store
    const entry = memoryStore.get(fullKey);
    if (entry) {
      if (entry.blockedUntil && entry.blockedUntil > now) {
        const retryAfter = Math.ceil((entry.blockedUntil - now) / 1000);
        return {
          allowed: false,
          remaining: 0,
          limit: points,
          resetIn: retryAfter,
          retryAfter,
        };
      }

      if (entry.resetAt > now) {
        return {
          allowed: entry.count < points,
          remaining: Math.max(0, points - entry.count),
          limit: points,
          resetIn: Math.ceil((entry.resetAt - now) / 1000),
        };
      }
    }

    // No entry means full capacity
    return {
      allowed: true,
      remaining: points,
      limit: points,
      resetIn: duration,
    };
  }

  /**
   * Reset rate limit for a key
   */
  async function reset(key: string): Promise<void> {
    const fullKey = `${keyPrefix}:${key}`;

    // Delete from memory
    memoryStore.delete(fullKey);

    // Delete from Redis
    const redis = getRedis();
    if (redis && isRedisConnected()) {
      try {
        await redis.del(fullKey, `${fullKey}:block`);
      } catch (err) {
        console.warn('[RateLimiter] Redis reset failed:', err);
      }
    }
  }

  return {
    consume,
    get,
    reset,
    config: { points, duration, blockDuration, keyPrefix },
  };
}

/**
 * Pre-configured rate limiters
 */

/** Strict: 10 requests per minute (for auth endpoints) */
export const strictLimiter = createRateLimiter({
  points: 10,
  duration: 60,
  blockDuration: 300, // 5 minute block
  keyPrefix: 'rl:strict',
});

/** Standard: 100 requests per minute (for general API) */
export const standardLimiter = createRateLimiter({
  points: 100,
  duration: 60,
  keyPrefix: 'rl:standard',
});

/** Relaxed: 500 requests per minute (for read operations) */
export const relaxedLimiter = createRateLimiter({
  points: 500,
  duration: 60,
  keyPrefix: 'rl:relaxed',
});

/** Plugin: 100 requests per minute per plugin */
export const pluginLimiter = createRateLimiter({
  points: 100,
  duration: 60,
  keyPrefix: 'rl:plugin',
});
