import { timingSafeEqual } from 'node:crypto';
import type { NextRequest } from 'next/server';

/**
 * Validates the CRON_SECRET Authorization header using a constant-time comparison
 * to prevent timing-based secret extraction.
 *
 * Returns true only when:
 *   1. CRON_SECRET is set in the environment.
 *   2. The request carries `Authorization: Bearer <CRON_SECRET>`.
 *   3. The comparison is length-safe and bit-safe.
 */
export function verifyCronAuth(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const auth = request.headers.get('authorization');
  if (!auth) return false;
  const expected = `Bearer ${secret}`;
  const authBuf = Buffer.from(auth, 'utf8');
  const expectedBuf = Buffer.from(expected, 'utf8');
  if (authBuf.length !== expectedBuf.length) return false;
  return timingSafeEqual(authBuf, expectedBuf);
}
