/**
 * Service Gateway — Policy Engine
 *
 * Enforces rate limits, quotas, and request size constraints.
 * Uses @naap/cache createRateLimiter for distributed rate limiting.
 */

import { createRateLimiter } from '@naap/cache';
import { prisma } from '@/lib/db';
import type { AuthenticatedAuthResult, ResolvedEndpoint } from './types';

export interface PolicyResult {
  allowed: boolean;
  reason?: string;
  statusCode?: number;
  headers?: Record<string, string>;
}

// Dynamic rate limiter cache (one per unique rate limit value)
const LIMITER_CACHE = new Map<number, ReturnType<typeof createRateLimiter>>();

function getLimiter(rateLimit: number) {
  let limiter = LIMITER_CACHE.get(rateLimit);
  if (!limiter) {
    limiter = createRateLimiter({
      points: rateLimit,
      duration: 60,
      keyPrefix: 'rl:gw',
    });
    LIMITER_CACHE.set(rateLimit, limiter);
  }
  return limiter;
}

/**
 * Enforce all policies for a gateway request.
 */
export async function enforcePolicy(
  auth: AuthenticatedAuthResult,
  endpoint: ResolvedEndpoint,
  requestBytes: number
): Promise<PolicyResult> {
  // ── Rate Limiting ──
  const rateLimit = endpoint.rateLimit || auth.rateLimit || 100;
  const limiterKey = auth.apiKeyId || `jwt:${auth.callerId}`;
  const limiter = getLimiter(rateLimit);
  const rlResult = await limiter.consume(limiterKey);

  if (!rlResult.allowed) {
    return {
      allowed: false,
      reason: 'Rate limit exceeded',
      statusCode: 429,
      headers: {
        'X-RateLimit-Limit': String(rlResult.limit),
        'X-RateLimit-Remaining': '0',
        'X-RateLimit-Reset': String(rlResult.resetIn),
        'Retry-After': String(rlResult.retryAfter || rlResult.resetIn),
      },
    };
  }

  // ── Daily Quota ──
  // NOTE: Quota checks are non-atomic (count-then-compare). Under high concurrency,
  // parallel requests can overshoot by the number of concurrent in-flight requests.
  // For strict enforcement, migrate to Redis INCR-based counters.
  if (auth.dailyQuota) {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const dailyCount = await prisma.gatewayUsageRecord.count({
      where: {
        teamId: auth.teamId,
        ...(auth.apiKeyId ? { apiKeyId: auth.apiKeyId } : { callerId: auth.callerId }),
        timestamp: { gte: todayStart },
      },
    });

    if (dailyCount >= auth.dailyQuota) {
      return {
        allowed: false,
        reason: `Daily quota exceeded (${auth.dailyQuota} requests/day)`,
        statusCode: 429,
        headers: {
          'X-Quota-Daily-Limit': String(auth.dailyQuota),
          'X-Quota-Daily-Used': String(dailyCount),
        },
      };
    }
  }

  // ── Monthly Quota ──
  if (auth.monthlyQuota) {
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);

    const monthlyCount = await prisma.gatewayUsageRecord.count({
      where: {
        teamId: auth.teamId,
        ...(auth.apiKeyId ? { apiKeyId: auth.apiKeyId } : { callerId: auth.callerId }),
        timestamp: { gte: monthStart },
      },
    });

    if (monthlyCount >= auth.monthlyQuota) {
      return {
        allowed: false,
        reason: `Monthly quota exceeded (${auth.monthlyQuota} requests/month)`,
        statusCode: 429,
        headers: {
          'X-Quota-Monthly-Limit': String(auth.monthlyQuota),
          'X-Quota-Monthly-Used': String(monthlyCount),
        },
      };
    }
  }

  // ── Request Size ──
  const maxSize = endpoint.maxRequestSize ?? auth.maxRequestSize;
  if (maxSize != null && requestBytes > maxSize) {
    return {
      allowed: false,
      reason: `Request body exceeds maximum size of ${maxSize} bytes`,
      statusCode: 413,
    };
  }

  return {
    allowed: true,
    headers: {
      'X-RateLimit-Limit': String(rlResult.limit),
      'X-RateLimit-Remaining': String(rlResult.remaining),
      'X-RateLimit-Reset': String(rlResult.resetIn),
    },
  };
}
