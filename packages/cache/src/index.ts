/**
 * @naap/cache
 *
 * Distributed caching and rate limiting for NAAP services.
 * Uses Redis with automatic in-memory fallback.
 */

// Redis client
export {
  getRedis,
  isRedisConnected,
  getRedisError,
  closeRedis,
  resetRedis,
  type RedisConfig,
} from './redis.js';

// Cache layer
export {
  cacheGet,
  cacheSet,
  cacheDel,
  cacheGetOrSet,
  cacheInvalidate,
  cacheInvalidateTeam,
  cacheInvalidateUser,
  cacheClear,
  getCacheStats,
  type CacheOptions,
} from './cache.js';

// Rate limiter
export {
  createRateLimiter,
  strictLimiter,
  standardLimiter,
  relaxedLimiter,
  pluginLimiter,
  type RateLimitConfig,
  type RateLimitResult,
} from './rateLimiter.js';

// Express middleware
export {
  rateLimitMiddleware,
  strictRateLimit,
  standardRateLimit,
  relaxedRateLimit,
  pluginRateLimit,
  cacheMiddleware,
  invalidateCacheMiddleware,
  cacheHeaders,
  noCacheHeaders,
  cachePrivate1m,
  cachePrivate5m,
  cachePublic1h,
  type RateLimitMiddlewareConfig,
  type CacheMiddlewareConfig,
} from './middleware.js';
