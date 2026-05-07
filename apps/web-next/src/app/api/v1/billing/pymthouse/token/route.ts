/**
 * POST /api/v1/billing/pymthouse/token
 *
 * Mint a fresh opaque `pmth_…` signer session for the currently logged-in NaaP user.
 * Internally: upsert user, mint short-lived `sign:job` JWT, RFC 8693 token exchange
 * with the M2M client. Safe to call on every request when callers need a new session.
 *
 * Response shape (RFC 6749-ish):
 *   { access_token, token_type: "Bearer", expires_in, scope }
 */

import { NextRequest, NextResponse } from 'next/server';
import { success, errors, getAuthToken } from '@/lib/api/response';
import { validateSession } from '@/lib/api/auth';
import { validateCSRF } from '@/lib/api/csrf';
import { PYMTHOUSE_NOT_CONFIGURED_MESSAGE } from '@/lib/pymthouse-env';
import {
  isPymthouseConfigured,
  mintPymthouseSignerSessionForNaapUser,
} from '@/lib/pymthouse-oidc';

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_PER_USER = 30;

/** In-process limiter: resets on cold start; see checkRateLimit. */
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

function pruneRateLimitMap(now: number): void {
  for (const [key, entry] of rateLimitMap) {
    if (now >= entry.resetAt) {
      rateLimitMap.delete(key);
    }
  }
}

function checkRateLimit(userId: string): boolean {
  const now = Date.now();
  pruneRateLimitMap(now);
  const entry = rateLimitMap.get(userId);
  if (!entry || now >= entry.resetAt) {
    rateLimitMap.set(userId, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }
  if (entry.count >= RATE_LIMIT_MAX_PER_USER) {
    return false;
  }
  entry.count++;
  return true;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const token = getAuthToken(request);
    if (!token) {
      return errors.unauthorized('No auth token provided');
    }

    const csrfError = validateCSRF(request, token);
    if (csrfError) {
      return csrfError;
    }

    const authUser = await validateSession(token);
    if (!authUser) {
      return errors.unauthorized('Invalid or expired session');
    }

    if (!checkRateLimit(authUser.id)) {
      return errors.tooManyRequests(
        'Too many PymtHouse token requests. Please try again in a minute.',
      );
    }

    if (!isPymthouseConfigured()) {
      return errors.badRequest(PYMTHOUSE_NOT_CONFIGURED_MESSAGE);
    }

    try {
      const session = await mintPymthouseSignerSessionForNaapUser(authUser.id, {
        email: authUser.email ?? undefined,
      });

      const response = success({
        access_token: session.accessToken,
        token_type: session.tokenType,
        expires_in: session.expiresIn,
        scope: session.scope,
      });
      response.headers.set('Cache-Control', 'no-store');
      return response;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      console.error('[billing-auth:pymthouse] Signer session error:', msg);
      return errors.badRequest(`PymtHouse signer session failed: ${msg}`);
    }
  } catch (err) {
    console.error('[billing-auth:pymthouse] Unexpected token error:', err);
    return errors.internal('Failed to issue PymtHouse signer session');
  }
}
