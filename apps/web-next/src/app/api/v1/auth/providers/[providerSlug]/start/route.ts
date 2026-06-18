/**
 * POST /api/v1/auth/providers/:providerSlug/start
 * Start a brokered billing-provider authentication session.
 *
 * - daydream: browser-redirect OAuth (unchanged).
 * - pymthouse: server-to-server PymtHouse user API key mint (Dashboard parity).
 *   NaaP provisions the app user and mints a long-lived pmth_* key via the Builder
 *   Apps API. The SDK exchanges that key for a short-lived signer JWT at runtime
 *   via POST /api/pymthouse/keys/exchange. The frontend skips popup/polling.
 *
 *   Opaque signer sessions remain available via POST /api/v1/billing/pymthouse/token.
 */

import * as crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { PmtHouseError } from '@pymthouse/builder-sdk';
import { success, errors, getAuthToken } from '@/lib/api/response';
import { validateSession } from '@/lib/api/auth';
import { validateCSRF } from '@/lib/api/csrf';
import { enforceRateLimit } from '@/lib/api/rate-limit';
import { prisma } from '@/lib/db';
import {
  isPymthouseConfigured,
  PYMTHOUSE_NOT_CONFIGURED_MESSAGE,
} from '@pymthouse/builder-sdk/config';
import { SIGN_JOB_SCOPE } from '@pymthouse/builder-sdk';
import { createPymthouseApiKey } from '@/lib/pymthouse-keys-bff';
import { isRedirectFlowBillingProvider } from '@/lib/billing-providers';

const LOGIN_SESSION_TTL_MS = 10 * 60 * 1000; // 10 minutes
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 5;
/** Nominal OAuth-session TTL when pymthouse start completes immediately (key itself is long-lived). */
const PYMTHOUSE_START_SESSION_TTL_MS = 365 * 24 * 60 * 60 * 1000;

/**
 * PymtHouse: provision app user + mint long-lived pmth_* API key (exchangeable by SDK).
 */
async function executePymthouseUserLink(
  naapUserId: string | null,
  userEmail?: string | null,
): Promise<string | null> {
  if (!isPymthouseConfigured()) {
    return null;
  }

  if (!naapUserId) {
    return null;
  }

  const { apiKey } = await createPymthouseApiKey({
    externalUserId: naapUserId,
    email: userEmail,
  });
  return apiKey;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ providerSlug: string }> }
): Promise<NextResponse> {
  try {
    const { providerSlug } = await params;

    const csrfError = validateCSRF(request);
    if (csrfError) {
      return csrfError;
    }

    // See `@/lib/api/rate-limit` for the operational caveats — this is a
    // soft per-instance throttle, not a hard cross-instance ceiling.
    const rateLimitRes = enforceRateLimit(request, {
      keyPrefix: `billing-auth-start:${providerSlug}`,
      windowMs: RATE_LIMIT_WINDOW_MS,
      maxRequests: RATE_LIMIT_MAX,
    });
    if (rateLimitRes) {
      return rateLimitRes;
    }

    const body = await request.json().catch(() => ({}));
    // Validate runtime types so malformed client input never reaches Prisma.
    const gatewayNonce =
      typeof body.gateway_nonce === 'string'
        ? body.gateway_nonce
        : crypto.randomBytes(32).toString('hex');
    const gatewayInstanceId =
      typeof body.gateway_instance_id === 'string' ? body.gateway_instance_id : null;

    const authToken = getAuthToken(request);
    const authenticatedUser = authToken ? await validateSession(authToken) : null;
    const naapUserId = authenticatedUser?.id ?? null;

    // PymtHouse requires an authenticated user to mint a signer session.
    if (providerSlug === 'pymthouse' && !naapUserId) {
      return errors.unauthorized('You must be signed in to link a PymtHouse billing provider');
    }

    const loginSessionId = crypto.randomBytes(32).toString('hex');

    // ── PymtHouse: Builder user API key (pmth_*, SDK exchangeable) ─────────
    if (providerSlug === 'pymthouse') {
      let apiKey: string | null;
      try {
        apiKey = await executePymthouseUserLink(
          naapUserId,
          authenticatedUser?.email,
        );
      } catch (err) {
        const msg = err instanceof PmtHouseError ? err.message : err instanceof Error ? err.message : 'Unknown error';
        console.error('[billing-auth:pymthouse] Builder API error:', { msg, err });
        return errors.badRequest(
          'User linking failed; please try again or contact support.',
        );
      }

      if (!apiKey) {
        return errors.badRequest(PYMTHOUSE_NOT_CONFIGURED_MESSAGE);
      }

      await prisma.billingProviderOAuthSession.create({
        data: {
          loginSessionId,
          providerSlug,
          gatewayNonce,
          gatewayInstanceId,
          naapUserId,
          state: crypto.randomBytes(16).toString('hex'),
          status: 'complete',
          accessToken: null,
          providerUserId: naapUserId,
          redeemedAt: new Date(),
          expiresAt: new Date(Date.now() + PYMTHOUSE_START_SESSION_TTL_MS),
        },
      });

      console.log(`[billing-auth:pymthouse] Linked user ${naapUserId?.slice(0, 8)}... session ${loginSessionId.slice(0, 8)}...`);

      const tokenRes = success({
        auth_url: null,
        access_token: apiKey,
        token_type: 'Bearer',
        scope: SIGN_JOB_SCOPE,
        login_session_id: loginSessionId,
        expires_in: Math.floor(PYMTHOUSE_START_SESSION_TTL_MS / 1000),
        poll_after_ms: 0,
      });
      tokenRes.headers.set('Cache-Control', 'no-store');
      return tokenRes;
    }

    // ── Daydream (and any future) OAuth redirect flow ────────────────────────
    // The provider authorization URL is resolved server-side by the same-origin
    // /api/v1/auth/providers/[slug]/redirect route, so we never hand a remote URL
    // back to the browser to open. Here we only persist the session state.
    if (!isRedirectFlowBillingProvider(providerSlug)) {
      return errors.badRequest(`Unsupported billing provider for OAuth: ${providerSlug}`);
    }

    const state = crypto.randomBytes(16).toString('hex');

    await prisma.billingProviderOAuthSession.create({
      data: {
      loginSessionId,
      providerSlug,
      gatewayNonce,
      gatewayInstanceId,
      naapUserId,
      state,
      status: 'pending',
      accessToken: null,
      providerUserId: null,
      redeemedAt: null,
      expiresAt: new Date(Date.now() + LOGIN_SESSION_TTL_MS),
      },
    });

    console.log(`[billing-auth:${providerSlug}] Started login session ${loginSessionId.slice(0, 8)}...`);

    const startRes = success({
      login_session_id: loginSessionId,
      expires_in: Math.floor(LOGIN_SESSION_TTL_MS / 1000),
      poll_after_ms: 1500,
    });
    // no-store: login_session_id is a redirect-flow continuation handle, mirror
    // the PymtHouse token branch above.
    startRes.headers.set('Cache-Control', 'no-store');
    return startRes;
  } catch (err) {
    console.error('[billing-auth] Error starting login:', err);
    return errors.internal('Failed to start billing provider login');
  }
}
