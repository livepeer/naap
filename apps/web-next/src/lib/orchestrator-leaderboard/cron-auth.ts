import { createHmac, timingSafeEqual } from 'node:crypto';
import type { NextRequest } from 'next/server';

/**
 * Validates the CRON_SECRET Authorization header using a constant-time comparison
 * to prevent timing-based secret extraction.
 *
 * Both values are HMAC-SHA256 hashed first, which normalizes them to a fixed
 * length and eliminates the length-based timing leak that an early length check
 * (or a raw `timingSafeEqual` on different-sized buffers) would expose.
 *
 * Returns true only when:
 *   1. CRON_SECRET is set in the environment.
 *   2. The request carries `Authorization: Bearer <CRON_SECRET>`.
 *   3. The HMAC comparison is constant-time.
 */
const CRON_AUTH_HMAC_KEY = 'naap-cron-auth';

export function verifyCronAuth(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const auth = request.headers.get('authorization');
  if (!auth) return false;
  const expected = `Bearer ${secret}`;
  const hmac = (value: string): Buffer =>
    createHmac('sha256', CRON_AUTH_HMAC_KEY).update(value).digest();
  return timingSafeEqual(hmac(auth), hmac(expected));
}
