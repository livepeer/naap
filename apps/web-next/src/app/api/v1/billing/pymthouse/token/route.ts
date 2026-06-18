/**
 * POST /api/v1/billing/pymthouse/token
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  isPymthouseConfigured,
  PYMTHOUSE_NOT_CONFIGURED_MESSAGE,
} from '@pymthouse/builder-sdk/config';
import { success, errors, getAuthToken } from '@/lib/api/response';
import { validateSession } from '@/lib/api/auth';
import { validateCSRF } from '@/lib/api/csrf';
import { enforceRateLimit } from '@/lib/api/rate-limit';
import { mintSignerSessionForExternalUser } from '@/lib/pymthouse-client';

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_PER_USER = 30;

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const token = getAuthToken(request);
    if (!token) {
      return errors.unauthorized('No auth token provided');
    }

    const csrfError = validateCSRF(request);
    if (csrfError) {
      return csrfError;
    }

    const authUser = await validateSession(token);
    if (!authUser) {
      return errors.unauthorized('Invalid or expired session');
    }

    const rateLimitRes = enforceRateLimit(request, {
      keyPrefix: `pymthouse-token:${authUser.id}`,
      windowMs: RATE_LIMIT_WINDOW_MS,
      maxRequests: RATE_LIMIT_MAX_PER_USER,
    });
    if (rateLimitRes) {
      return rateLimitRes;
    }

    if (!isPymthouseConfigured()) {
      return errors.badRequest(PYMTHOUSE_NOT_CONFIGURED_MESSAGE);
    }

    try {
      const session = await mintSignerSessionForExternalUser({
        externalUserId: authUser.id,
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
      return errors.badRequest('PymtHouse signer session failed');
    }
  } catch (err) {
    console.error('[billing-auth:pymthouse] Unexpected token error:', err);
    return errors.internal('Failed to issue PymtHouse signer session');
  }
}
