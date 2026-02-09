/**
 * Rate Limiting Utility for Vercel Edge/Serverless
 *
 * Uses in-memory LRU cache for rate limiting.
 * In production with multiple instances, consider using:
 * - Vercel KV (Redis)
 * - Upstash Redis
 * - Edge Config
 */

interface RateLimitConfig {
  /** Maximum number of requests */
  limit: number;
  /** Time window in seconds */
  window: number;
  /** Identifier for this rate limit (e.g., 'auth', 'api') */
  identifier?: string;
}

interface RateLimitResult {
  success: boolean;
  limit: number;
  remaining: number;
  reset: number;
  retryAfter?: number;
}

// Simple in-memory store with LRU eviction
// For production with multiple instances, use Redis/KV
const store = new Map<string, { count: number; resetAt: number }>();
const MAX_STORE_SIZE = 10000;

function cleanupStore() {
  const now = Date.now();

  // Remove expired entries
  for (const [key, value] of store.entries()) {
    if (value.resetAt < now) {
      store.delete(key);
    }
  }

  // If still too large, remove oldest entries
  if (store.size > MAX_STORE_SIZE) {
    const entries = Array.from(store.entries());
    entries.sort((a, b) => a[1].resetAt - b[1].resetAt);
    const toRemove = entries.slice(0, store.size - MAX_STORE_SIZE + 1000);
    for (const [key] of toRemove) {
      store.delete(key);
    }
  }
}

/**
 * Check rate limit for a given key
 *
 * @param key - Unique identifier (usually IP or user ID)
 * @param config - Rate limit configuration
 * @returns Rate limit result
 *
 * @example
 * ```typescript
 * const result = await rateLimit(ip, { limit: 10, window: 60 });
 * if (!result.success) {
 *   return new Response('Too many requests', { status: 429 });
 * }
 * ```
 */
export async function rateLimit(
  key: string,
  config: RateLimitConfig
): Promise<RateLimitResult> {
  const { limit, window, identifier = 'default' } = config;
  const storeKey = `${identifier}:${key}`;
  const now = Date.now();
  const windowMs = window * 1000;

  // Cleanup periodically
  if (Math.random() < 0.01) {
    cleanupStore();
  }

  const entry = store.get(storeKey);

  if (!entry || entry.resetAt < now) {
    // New window
    const resetAt = now + windowMs;
    store.set(storeKey, { count: 1, resetAt });

    return {
      success: true,
      limit,
      remaining: limit - 1,
      reset: Math.ceil(resetAt / 1000),
    };
  }

  if (entry.count >= limit) {
    // Rate limited
    const retryAfter = Math.ceil((entry.resetAt - now) / 1000);

    return {
      success: false,
      limit,
      remaining: 0,
      reset: Math.ceil(entry.resetAt / 1000),
      retryAfter,
    };
  }

  // Increment count
  entry.count++;
  store.set(storeKey, entry);

  return {
    success: true,
    limit,
    remaining: limit - entry.count,
    reset: Math.ceil(entry.resetAt / 1000),
  };
}

/**
 * Pre-configured rate limiters for common use cases
 */
export const rateLimiters = {
  /**
   * Strict rate limit for authentication endpoints
   * 10 requests per minute per IP
   */
  auth: (ip: string) =>
    rateLimit(ip, {
      limit: 10,
      window: 60,
      identifier: 'auth',
    }),

  /**
   * Standard API rate limit
   * 100 requests per minute per IP
   */
  api: (ip: string) =>
    rateLimit(ip, {
      limit: 100,
      window: 60,
      identifier: 'api',
    }),

  /**
   * Strict rate limit for registration
   * 5 requests per hour per IP
   */
  registration: (ip: string) =>
    rateLimit(ip, {
      limit: 5,
      window: 3600,
      identifier: 'registration',
    }),

  /**
   * Rate limit for file uploads
   * 20 uploads per minute per user
   */
  upload: (userId: string) =>
    rateLimit(userId, {
      limit: 20,
      window: 60,
      identifier: 'upload',
    }),
};

/**
 * Get client IP from request headers
 * Works with Vercel, Cloudflare, and standard proxies
 */
export function getClientIp(request: Request): string {
  // Vercel
  const vercelIp = request.headers.get('x-real-ip');
  if (vercelIp) return vercelIp;

  // Cloudflare
  const cfIp = request.headers.get('cf-connecting-ip');
  if (cfIp) return cfIp;

  // Standard forwarded header
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }

  // Fallback
  return '127.0.0.1';
}

/**
 * Create rate limit response headers
 */
export function rateLimitHeaders(result: RateLimitResult): HeadersInit {
  const headers: HeadersInit = {
    'X-RateLimit-Limit': result.limit.toString(),
    'X-RateLimit-Remaining': result.remaining.toString(),
    'X-RateLimit-Reset': result.reset.toString(),
  };

  if (result.retryAfter) {
    headers['Retry-After'] = result.retryAfter.toString();
  }

  return headers;
}

/**
 * Apply rate limiting to a request
 * Returns a Response if rate limited, null otherwise
 *
 * @example
 * ```typescript
 * export async function POST(request: Request) {
 *   const limited = await applyRateLimit(request, rateLimiters.auth);
 *   if (limited) return limited;
 *   // ... handle request
 * }
 * ```
 */
export async function applyRateLimit(
  request: Request,
  limiter: (key: string) => Promise<RateLimitResult>
): Promise<Response | null> {
  const ip = getClientIp(request);
  const result = await limiter(ip);

  if (!result.success) {
    return new Response(
      JSON.stringify({
        error: 'Too many requests',
        message: `Rate limit exceeded. Please try again in ${result.retryAfter} seconds.`,
        retryAfter: result.retryAfter,
      }),
      {
        status: 429,
        headers: {
          'Content-Type': 'application/json',
          ...rateLimitHeaders(result),
        },
      }
    );
  }

  return null;
}
