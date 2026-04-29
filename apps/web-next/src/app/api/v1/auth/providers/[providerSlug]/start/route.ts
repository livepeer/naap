/**
 * POST /api/v1/auth/providers/:providerSlug/start
 * Start a brokered billing-provider authentication session.
 *
 * - daydream: browser-redirect OAuth (unchanged).
 * - pymthouse: server-to-server Basic-auth Builder API (no browser popup).
 *   NaaP upserts the user on PymtHouse and returns a fresh short-lived
 *   `sign:job` JWT as `access_token` in the response. The frontend receives
 *   `access_token` directly and skips popup/polling.
 *
 *   The JWT is intentionally short-lived (~15 min) and is NOT persisted.
 *   For subsequent requests, callers should re-mint via
 *   POST /api/v1/billing/pymthouse/token.
 */

import * as crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { success, errors, getAuthToken } from '@/lib/api/response';
import { validateSession } from '@/lib/api/auth';
import { prisma } from '@/lib/db';
import { resolveBillingOAuthAppUrl } from '@/lib/billing-oauth-origin';
import { PYMTHOUSE_NOT_CONFIGURED_MESSAGE } from '@/lib/pymthouse-env';
import {
  isPymthouseConfigured,
  issuePymthouseUserAccessToken,
  type PymthouseUserAccessToken,
} from '@/lib/pymthouse-oidc';

const DAYDREAM_AUTH_URL =
  process.env.DAYDREAM_AUTH_URL || 'https://app.daydream.live/sign-in/local';
const LOGIN_SESSION_TTL_MS = 10 * 60 * 1000; // 10 minutes
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 5;

const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(key: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(key);
  if (!entry || now >= entry.resetAt) {
    rateLimitMap.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }
  if (entry.count >= RATE_LIMIT_MAX) {
    return false;
  }
  entry.count++;
  return true;
}

function resolveProviderAuthUrl(providerSlug: string): string | null {
  if (providerSlug === 'daydream') {
    return DAYDREAM_AUTH_URL;
  }
  return null;
}

async function buildDaydreamAuthUrl(
  callbackUrl: string
): Promise<{ authUrl: string } | null> {
  const base = resolveProviderAuthUrl('daydream');
  if (!base) return null;
  const state = crypto.randomBytes(16).toString('hex');
  return {
    authUrl: `${base}?redirect_url=${encodeURIComponent(callbackUrl)}&state=${encodeURIComponent(state)}`,
  };
}

/**
 * PymtHouse: pure server-to-server Basic-auth flow. Upserts the user and mints
 * a fresh short-lived `sign:job` JWT — no browser redirect, no persistence.
 */
async function executePymthouseUserLink(
  naapUserId: string | null,
  userEmail?: string | null,
): Promise<PymthouseUserAccessToken | null> {
  if (!isPymthouseConfigured()) {
    return null;
  }

  if (!naapUserId) {
    throw new Error('User must be logged in to link a PymtHouse billing provider');
  }

  return issuePymthouseUserAccessToken(naapUserId, {
    email: userEmail ?? undefined,
  });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ providerSlug: string }> }
): Promise<NextResponse> {
  try {
    const { providerSlug } = await params;

    const clientIp = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    if (!checkRateLimit(`billing-auth:${clientIp}`)) {
      return errors.tooManyRequests('Too many authentication requests. Please try again later.');
    }

    const body = await request.json().catch(() => ({}));
    const gatewayNonce = (body.gateway_nonce as string) || crypto.randomBytes(32).toString('hex');
    const gatewayInstanceId = (body.gateway_instance_id as string) || null;

    const authToken = getAuthToken(request);
    const authenticatedUser = authToken ? await validateSession(authToken) : null;
    const naapUserId = authenticatedUser?.id ?? null;

    const loginSessionId = crypto.randomBytes(32).toString('hex');

    // ── PymtHouse: Basic-auth Builder API (docs/builder-api.md) ──────────────
    // NaaP client Basic-auths to PymtHouse → upsert user → POST .../token { scope: sign:job }.
    // The JWT is short-lived (~15 min) and is NOT persisted; callers re-mint on demand
    // via POST /api/v1/billing/pymthouse/token.
    if (providerSlug === 'pymthouse') {
      let token: PymthouseUserAccessToken | null;
      try {
        token = await executePymthouseUserLink(
          naapUserId,
          authenticatedUser?.email,
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        console.error('[billing-auth:pymthouse] Builder API error:', msg);
        return errors.badRequest(
          `PymtHouse user linking failed: ${msg}. ` +
            'Ensure PYMTHOUSE_ISSUER_URL (…/api/v1/oidc), PYMTHOUSE_PUBLIC_CLIENT_ID (app_…), PYMTHOUSE_M2M_CLIENT_ID, and PYMTHOUSE_M2M_CLIENT_SECRET are set, ' +
            'and the confidential client on PymtHouse allows users:read, users:write, and users:token.',
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
          pkceCodeVerifier: null,
          status: 'complete',
          accessToken: null,
          providerUserId: naapUserId,
          redeemedAt: new Date(),
          expiresAt: new Date(Date.now() + token.expiresIn * 1000),
        },
      });

      console.log(`[billing-auth:pymthouse] Linked user ${naapUserId?.slice(0, 8)}... session ${loginSessionId.slice(0, 8)}...`);

      return success({
        auth_url: null,
        access_token: token.accessToken,
        token_type: token.tokenType,
        scope: token.scope,
        login_session_id: loginSessionId,
        expires_in: token.expiresIn,
        poll_after_ms: 0,
      });
    }

    // ── Daydream (and any future) OAuth redirect flow ────────────────────────
    const appUrl = resolveBillingOAuthAppUrl(request);
    const callbackUrl = `${appUrl}/api/v1/auth/providers/${encodeURIComponent(providerSlug)}/callback`;

    const built = providerSlug === 'daydream'
      ? await buildDaydreamAuthUrl(callbackUrl)
      : null;

    if (!built) {
      return errors.badRequest(`Unsupported billing provider for OAuth: ${providerSlug}`);
    }

    const state = new URL(built.authUrl).searchParams.get('state');
    if (!state) {
      return errors.internal('Failed to build OAuth state');
    }

    await prisma.billingProviderOAuthSession.create({
      data: {
        loginSessionId,
        providerSlug,
        gatewayNonce,
        gatewayInstanceId,
        naapUserId,
        state,
        pkceCodeVerifier: null,
        status: 'pending',
        accessToken: null,
        providerUserId: null,
        redeemedAt: null,
        expiresAt: new Date(Date.now() + LOGIN_SESSION_TTL_MS),
      },
    });

    console.log(`[billing-auth:${providerSlug}] Started login session ${loginSessionId.slice(0, 8)}...`);

    return success({
      auth_url: built.authUrl,
      login_session_id: loginSessionId,
      expires_in: Math.floor(LOGIN_SESSION_TTL_MS / 1000),
      poll_after_ms: 1500,
    });
  } catch (err) {
    console.error('[billing-auth] Error starting login:', err);
    return errors.internal('Failed to start billing provider login');
  }
}
