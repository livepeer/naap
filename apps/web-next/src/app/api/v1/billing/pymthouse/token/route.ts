/**
 * POST /api/v1/billing/pymthouse/token
 *
 * Mint a fresh short-lived `sign:job` JWT for the currently logged-in NaaP
 * user. Safe to call on every request — PymtHouse's user upsert is idempotent
 * and the returned JWT lives ~15 min. Callers should re-mint instead of
 * persisting the token.
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
  issuePymthouseUserAccessToken,
} from '@/lib/pymthouse-oidc';

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_PER_USER = 30;

const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(userId: string): boolean {
  const now = Date.now();
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
      const minted = await issuePymthouseUserAccessToken(authUser.id, {
        email: authUser.email ?? undefined,
      });

      const response = success({
        access_token: minted.accessToken,
        token_type: minted.tokenType,
        expires_in: minted.expiresIn,
        scope: minted.scope,
      });
      response.headers.set('Cache-Control', 'no-store');
      return response;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      console.error('[billing-auth:pymthouse] Token mint error:', msg);
      return errors.badRequest(`PymtHouse token mint failed: ${msg}`);
    }
  } catch (err) {
    console.error('[billing-auth:pymthouse] Unexpected token error:', err);
    return errors.internal('Failed to mint PymtHouse token');
  }
}
