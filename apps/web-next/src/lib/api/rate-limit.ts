import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import { errors, getClientIP } from '@/lib/api/response';

/**
 * Best-effort, per-instance rate limiter.
 *
 * ⚠️ Operational note (Vercel Fluid Compute / horizontal scale-out):
 * the underlying `store` lives in module scope and resets on every cold
 * start. Each function instance keeps its own counter, so the effective
 * limit is N × `maxRequests` where N is the number of active instances.
 * Treat this as a soft throttle that absorbs trivial bursts, NOT as a
 * hard security boundary.
 *
 * For security-critical limits (e.g., per-user write fan-out, abuse
 * mitigation on auth endpoints) move to a durable cross-instance store
 * such as Upstash Redis or Vercel KV. This module's API can stay the
 * same; only the backing store needs to swap.
 */

type RateLimitEntry = {
  count: number;
  resetAt: number;
};

type RateLimitOptions = {
  keyPrefix: string;
  windowMs?: number;
  maxRequests?: number;
};

const DEFAULT_WINDOW_MS = 60_000;
const DEFAULT_MAX_REQUESTS = 10;
const MAX_STORE_SIZE = 10_000;
const store = new Map<string, RateLimitEntry>();

function cleanupExpiredEntries(now: number): void {
  if (store.size <= MAX_STORE_SIZE) {
    return;
  }

  for (const [key, entry] of store) {
    if (entry.resetAt <= now) {
      store.delete(key);
    }
  }
}

export function enforceRateLimit(
  request: Request,
  options: RateLimitOptions
): NextResponse | null {
  const now = Date.now();
  const windowMs = options.windowMs ?? DEFAULT_WINDOW_MS;
  const maxRequests = options.maxRequests ?? DEFAULT_MAX_REQUESTS;
  const ip = getClientIP(request);
  let pathname = '/';
  try {
    pathname = new URL(request.url).pathname;
  } catch {
    /* keep default */
  }
  const key = ip
    ? `${options.keyPrefix}:${ip}`
    : `${options.keyPrefix}:anon:${createHash('sha256')
        .update(
          [
            request.headers.get('user-agent') ?? '',
            request.headers.get('accept') ?? '',
            request.method,
            pathname,
          ].join('|'),
        )
        .digest('hex')
        .slice(0, 24)}`;
  const effectiveMaxRequests = ip ? maxRequests : Math.max(1, Math.min(maxRequests, 3));
  if (!ip) {
    console.warn('[rate-limit] Missing client IP; using fallback anonymous key');
  }

  cleanupExpiredEntries(now);

  const existing = store.get(key);
  if (!existing || now >= existing.resetAt) {
    store.set(key, { count: 1, resetAt: now + windowMs });
    return null;
  }

  if (existing.count >= effectiveMaxRequests) {
    const retryAfter = Math.max(1, Math.ceil((existing.resetAt - now) / 1000));
    const response = errors.rateLimited(retryAfter);
    response.headers.set('Retry-After', retryAfter.toString());
    return response;
  }

  existing.count += 1;
  return null;
}
