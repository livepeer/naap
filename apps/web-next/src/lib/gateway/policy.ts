/**
 * Service Gateway — Policy Engine
 *
 * Enforces rate limits, quotas, and request size constraints.
 * Uses @naap/cache createRateLimiter for distributed rate limiting.
 *
 * Quota enforcement uses Redis INCR with TTL-based expiry for O(1)
 * per-request checks instead of DB COUNT queries. Falls back to
 * DB queries when Redis is unavailable.
 */

import { createRateLimiter } from '@naap/cache';
import { getRedis } from '@naap/cache';
import { prisma } from '@/lib/db';
import type { AuthResult, ResolvedEndpoint } from './types';

export interface PolicyResult {
  allowed: boolean;
  reason?: string;
  statusCode?: number;
  headers?: Record<string, string>;
}

const MAX_LIMITER_ENTRIES = 256;
const LIMITER_CACHE = new Map<number, ReturnType<typeof createRateLimiter>>();

function getLimiter(rateLimit: number) {
  let limiter = LIMITER_CACHE.get(rateLimit);
  if (!limiter) {
    if (LIMITER_CACHE.size >= MAX_LIMITER_ENTRIES) {
      const oldest = LIMITER_CACHE.keys().next().value;
      if (oldest !== undefined) LIMITER_CACHE.delete(oldest);
    }
    limiter = createRateLimiter({
      points: rateLimit,
      duration: 60,
      keyPrefix: 'rl:gw',
    });
    LIMITER_CACHE.set(rateLimit, limiter);
  }
  return limiter;
}

function quotaCallerSuffix(auth: AuthResult): string {
  return auth.apiKeyId || `jwt:${auth.callerId}`;
}

function dailyQuotaKey(auth: AuthResult): string {
  const now = new Date();
  const day = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, '0')}${String(now.getUTCDate()).padStart(2, '0')}`;
  return `gw:quota:d:${auth.teamId}:${quotaCallerSuffix(auth)}:${day}`;
}

function monthlyQuotaKey(auth: AuthResult): string {
  const now = new Date();
  const month = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  return `gw:quota:m:${auth.teamId}:${quotaCallerSuffix(auth)}:${month}`;
}

function secondsUntilEndOfDay(): number {
  const now = new Date();
  const endOfDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  return Math.ceil((endOfDay.getTime() - now.getTime()) / 1000);
}

function secondsUntilEndOfMonth(): number {
  const now = new Date();
  const endOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return Math.ceil((endOfMonth.getTime() - now.getTime()) / 1000);
}

async function incrQuota(key: string, ttlSeconds: number): Promise<number> {
  const redis = getRedis();
  if (redis) {
    try {
      const count = await redis.eval(
        `local c = redis.call('INCR', KEYS[1])
         if c == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
         return c`,
        1, key, String(ttlSeconds)
      ) as number;
      return count;
    } catch {
      return -1;
    }
  }
  return -1;
}

async function getQuotaCountFallback(auth: AuthResult, since: Date): Promise<number> {
  return prisma.gatewayUsageRecord.count({
    where: {
      teamId: auth.teamId,
      ...(auth.apiKeyId ? { apiKeyId: auth.apiKeyId } : { callerId: auth.callerId }),
      timestamp: { gte: since },
    },
  });
}

/**
 * Enforce all policies for a gateway request.
 */
export async function enforcePolicy(
  auth: AuthResult,
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
  if (auth.dailyQuota) {
    let dailyCount = await incrQuota(dailyQuotaKey(auth), secondsUntilEndOfDay());
    if (dailyCount < 0) {
      const now = new Date();
      const todayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
      // +1 because the DB count doesn't include the current in-flight request
      dailyCount = (await getQuotaCountFallback(auth, todayStart)) + 1;
    }

    if (dailyCount > auth.dailyQuota) {
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
    let monthlyCount = await incrQuota(monthlyQuotaKey(auth), secondsUntilEndOfMonth());
    if (monthlyCount < 0) {
      const now = new Date();
      const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
      // +1 because the DB count doesn't include the current in-flight request
      monthlyCount = (await getQuotaCountFallback(auth, monthStart)) + 1;
    }

    if (monthlyCount > auth.monthlyQuota) {
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
