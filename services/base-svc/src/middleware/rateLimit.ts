/**
 * Rate Limiting Middleware
 *
 * Re-exports the distributed rate limiter from @naap/cache.
 * Uses Redis when available, with automatic in-memory fallback.
 *
 * For local development: works without Redis (in-memory).
 * For production: set REDIS_URL environment variable for distributed limiting.
 */

export {
  rateLimitMiddleware as rateLimit,
  strictRateLimit,
  standardRateLimit,
  relaxedRateLimit,
  pluginRateLimit,
} from '@naap/cache';

export {
  createRateLimiter,
  strictLimiter,
  standardLimiter,
  relaxedLimiter,
  pluginLimiter,
  type RateLimitConfig,
  type RateLimitResult,
} from '@naap/cache';
