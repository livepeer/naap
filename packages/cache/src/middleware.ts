/**
 * Express Middleware for Caching and Rate Limiting
 *
 * Ready-to-use middleware for Express applications.
 */

import type { Request, Response, NextFunction } from 'express';
import { cacheGetOrSet, cacheDel, CacheOptions } from './cache.js';
import {
  createRateLimiter,
  strictLimiter,
  standardLimiter,
  relaxedLimiter,
  pluginLimiter,
  RateLimitResult,
} from './rateLimiter.js';

/**
 * Rate limit middleware configuration
 */
export interface RateLimitMiddlewareConfig {
  /** Rate limiter to use (default: standardLimiter) */
  limiter?: ReturnType<typeof createRateLimiter>;
  /** Key generator function (default: user ID or IP) */
  keyGenerator?: (req: Request) => string;
  /** Skip rate limiting for certain requests */
  skip?: (req: Request) => boolean;
  /** Custom error message */
  message?: string;
}

/**
 * Default key generator - uses user ID if authenticated, otherwise IP
 */
function defaultKeyGenerator(req: Request): string {
  const user = (req as any).user;
  if (user?.id) {
    return `user:${user.id}`;
  }

  const ip =
    (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
    req.socket.remoteAddress ||
    'unknown';

  return `ip:${ip}`;
}

/**
 * Create rate limit middleware
 */
export function rateLimitMiddleware(config: RateLimitMiddlewareConfig = {}) {
  const {
    limiter = standardLimiter,
    keyGenerator = defaultKeyGenerator,
    skip,
    message = 'Too many requests, please try again later',
  } = config;

  return async (req: Request, res: Response, next: NextFunction) => {
    // Check if we should skip rate limiting
    if (skip?.(req)) {
      return next();
    }

    const key = keyGenerator(req);
    const result = await limiter.consume(key);

    // Set rate limit headers
    res.setHeader('X-RateLimit-Limit', result.limit.toString());
    res.setHeader('X-RateLimit-Remaining', result.remaining.toString());
    res.setHeader('X-RateLimit-Reset', (Math.floor(Date.now() / 1000) + result.resetIn).toString());

    if (!result.allowed) {
      res.setHeader('Retry-After', (result.retryAfter || result.resetIn).toString());
      return res.status(429).json({
        error: message,
        retryAfter: result.retryAfter || result.resetIn,
      });
    }

    next();
  };
}

/**
 * Pre-configured rate limit middleware
 */

/** Strict rate limit: 10 req/min (auth endpoints) */
export const strictRateLimit = rateLimitMiddleware({ limiter: strictLimiter });

/** Standard rate limit: 100 req/min */
export const standardRateLimit = rateLimitMiddleware({ limiter: standardLimiter });

/** Relaxed rate limit: 500 req/min (read endpoints) */
export const relaxedRateLimit = rateLimitMiddleware({ limiter: relaxedLimiter });

/**
 * Plugin-specific rate limit middleware
 * Rate limits by user + team combination
 */
export const pluginRateLimit = rateLimitMiddleware({
  limiter: pluginLimiter,
  keyGenerator: (req) => {
    const user = (req as any).user;
    const teamId = req.params.teamId || (req as any).team?.id;

    if (user?.id && teamId) {
      return `${user.id}:${teamId}`;
    }

    if (user?.id) {
      return user.id;
    }

    const ip =
      (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
      req.socket.remoteAddress ||
      'unknown';

    return `ip:${ip}`;
  },
});

/**
 * Response caching middleware configuration
 */
export interface CacheMiddlewareConfig {
  /** Time to live in seconds */
  ttl: number;
  /** Key generator function */
  keyFn?: (req: Request) => string;
  /** Condition to check before caching */
  condition?: (req: Request) => boolean;
  /** Cache key prefix */
  prefix?: string;
}

/**
 * Response caching middleware
 * Caches GET responses with automatic invalidation support
 */
export function cacheMiddleware(config: CacheMiddlewareConfig) {
  const { ttl, keyFn, condition, prefix = 'api' } = config;

  return async (req: Request, res: Response, next: NextFunction) => {
    // Only cache GET requests
    if (req.method !== 'GET') {
      return next();
    }

    // Check condition
    if (condition && !condition(req)) {
      return next();
    }

    const cacheKey = keyFn
      ? keyFn(req)
      : `${req.path}:${JSON.stringify(req.query)}`;

    const options: CacheOptions = { ttl, prefix };

    try {
      // Try to get from cache
      const cached = await cacheGetOrSet(
        cacheKey,
        async () => {
          // Intercept the response to capture data
          return new Promise<any>((resolve) => {
            const originalJson = res.json.bind(res);

            res.json = function(data: any) {
              resolve(data);
              res.setHeader('X-Cache', 'MISS');
              return originalJson(data);
            };

            // Continue to the actual handler
            next();
          });
        },
        options
      );

      // If we got cached data and didn't continue to handler
      if (cached !== undefined && !res.headersSent) {
        res.setHeader('X-Cache', 'HIT');
        return res.json(cached);
      }
    } catch (err) {
      // On error, just continue without caching
      console.warn('[CacheMiddleware] Error:', err);
      next();
    }
  };
}

/**
 * Cache invalidation middleware
 * Invalidates cache on successful mutations
 */
export function invalidateCacheMiddleware(patterns: string[] | ((req: Request) => string[])) {
  return async (req: Request, res: Response, next: NextFunction) => {
    // Store original end
    const originalEnd = res.end.bind(res);

    res.end = function(...args: any[]) {
      // Only invalidate on successful responses
      if (res.statusCode >= 200 && res.statusCode < 300) {
        const patternsToInvalidate = typeof patterns === 'function' ? patterns(req) : patterns;

        // Invalidate in background
        Promise.all(patternsToInvalidate.map((pattern) => cacheDel(pattern))).catch((err) => {
          console.warn('[CacheMiddleware] Invalidation error:', err);
        });
      }

      return originalEnd(...args);
    } as typeof res.end;

    next();
  };
}

/**
 * Add Cache-Control headers middleware
 */
export function cacheHeaders(maxAge: number = 0, isPrivate: boolean = true) {
  return (_req: Request, res: Response, next: NextFunction) => {
    if (maxAge > 0) {
      const directive = isPrivate ? 'private' : 'public';
      res.setHeader('Cache-Control', `${directive}, max-age=${maxAge}`);
    } else {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
    }
    next();
  };
}

/**
 * Pre-configured cache header middleware
 */
export const noCacheHeaders = cacheHeaders(0);
export const cachePrivate1m = cacheHeaders(60, true);
export const cachePrivate5m = cacheHeaders(300, true);
export const cachePublic1h = cacheHeaders(3600, false);
