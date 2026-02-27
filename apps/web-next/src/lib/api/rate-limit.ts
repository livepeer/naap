import { NextResponse } from 'next/server';
import { errors, getClientIP } from '@/lib/api/response';

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
  const ip = getClientIP(request) ?? 'unknown';
  const key = `${options.keyPrefix}:${ip}`;

  cleanupExpiredEntries(now);

  const existing = store.get(key);
  if (!existing || now >= existing.resetAt) {
    store.set(key, { count: 1, resetAt: now + windowMs });
    return null;
  }

  if (existing.count >= maxRequests) {
    const retryAfter = Math.max(1, Math.ceil((existing.resetAt - now) / 1000));
    const response = errors.rateLimited(retryAfter);
    response.headers.set('Retry-After', retryAfter.toString());
    return response;
  }

  existing.count += 1;
  return null;
}
