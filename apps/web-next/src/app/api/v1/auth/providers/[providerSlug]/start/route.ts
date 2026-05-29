/**
 * POST /api/v1/auth/providers/:providerSlug/start
 * Start a brokered billing-provider authentication session.
 *
 * - daydream: browser-redirect OAuth (unchanged).
 * - pymthouse: server-to-server Builder API + RFC 8693 token exchange (no browser popup).
 *   NaaP upserts the user, mints a short-lived internal `sign:job` JWT, exchanges it
 *   with the confidential M2M client for a long-lived opaque `pmth_…` signer session,
 *   and returns that token as `access_token`. The frontend skips popup/polling.
 *
 *   The short-lived JWT is never exposed as the developer API key. Callers may
 *   re-mint a fresh signer session via POST /api/v1/billing/pymthouse/token.
 */

import * as crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { success, errors, getAuthToken } from '@/lib/api/response';
import { validateSession } from '@/lib/api/auth';
import { validateCSRF } from '@/lib/api/csrf';
import { enforceRateLimit } from '@/lib/api/rate-limit';
import { prisma } from '@/lib/db';
import {
  isPymthouseConfigured,
  PYMTHOUSE_NOT_CONFIGURED_MESSAGE,
} from '@pymthouse/builder-sdk/config';
import type { SignerSessionToken } from '@pymthouse/builder-sdk/tokens';
import { getPmtHouseServerClient } from '@/lib/pymthouse-client';
import { isRedirectFlowBillingProvider } from '@/lib/billing-providers';

const LOGIN_SESSION_TTL_MS = 10 * 60 * 1000; // 10 minutes
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 5;

/**
 * PymtHouse: server-to-server Builder mint + issuer token exchange for a durable
 * opaque signer session — no browser redirect.
 */
async function executePymthouseUserLink(
  naapUserId: string | null,
  userEmail?: string | null,
): Promise<SignerSessionToken | null> {
  if (!isPymthouseConfigured()) {
    return null;
  }

  if (!naapUserId) {
    return null;
  }

  return getPmtHouseServerClient().mintSignerSessionForExternalUser({
    externalUserId: naapUserId,
    email: userEmail ?? undefined,
  });
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
    const gatewayNonce = (body.gateway_nonce as string) || crypto.randomBytes(32).toString('hex');
    const gatewayInstanceId = (body.gateway_instance_id as string) || null;

    const authToken = getAuthToken(request);
    const authenticatedUser = authToken ? await validateSession(authToken) : null;
    const naapUserId = authenticatedUser?.id ?? null;

    // PymtHouse requires an authenticated user to mint a signer session.
    if (providerSlug === 'pymthouse' && !naapUserId) {
      return errors.unauthorized('You must be signed in to link a PymtHouse billing provider');
    }

    const loginSessionId = crypto.randomBytes(32).toString('hex');

    // ── PymtHouse: Builder mint + RFC 8693 exchange (opaque pmth session) ───
    if (providerSlug === 'pymthouse') {
      let token: SignerSessionToken | null;
      try {
        token = await executePymthouseUserLink(
          naapUserId,
          authenticatedUser?.email,
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        console.error('[billing-auth:pymthouse] Builder API error:', { msg, err });
        return errors.badRequest(
          'User linking failed; please try again or contact support.',
        );
      }

      if (!token) {
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
          expiresAt: new Date(Date.now() + token.expiresIn * 1000),
        },
      });

      console.log(`[billing-auth:pymthouse] Linked user ${naapUserId?.slice(0, 8)}... session ${loginSessionId.slice(0, 8)}...`);

      const tokenRes = success({
        auth_url: null,
        access_token: token.accessToken,
        token_type: token.tokenType,
        scope: token.scope,
        login_session_id: loginSessionId,
        expires_in: token.expiresIn,
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

    return success({
      login_session_id: loginSessionId,
      expires_in: Math.floor(LOGIN_SESSION_TTL_MS / 1000),
      poll_after_ms: 1500,
    });
  } catch (err) {
    console.error('[billing-auth] Error starting login:', err);
    return errors.internal('Failed to start billing provider login');
  }
}
