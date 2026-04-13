/**
 * POST /api/v1/auth/providers/:providerSlug/start
 * Start a brokered billing-provider authentication session.
 *
 * - daydream: browser-redirect OAuth (unchanged).
 * - pymthouse: server-to-server client_credentials + link-user (no browser popup).
 *   NaaP obtains a service JWT from PymtHouse, provisions the NaaP user on
 *   PymtHouse, and returns the gateway API key directly in the response.
 *   The frontend receives `api_key` in the response and skips popup/polling.
 */

import * as crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { success, errors, getAuthToken } from '@/lib/api/response';
import { validateSession } from '@/lib/api/auth';
import { prisma } from '@/lib/db';
import { encryptToken } from '@naap/database';
import { resolveBillingOAuthAppUrl } from '@/lib/billing-oauth-origin';

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
 * PymtHouse: pure server-to-server client_credentials flow.
 * Returns the API key directly — no browser redirect.
 */
async function executePymthouseClientCredentials(
  naapUserId: string | null,
  userEmail?: string | null,
): Promise<{ apiKey: string } | null> {
  const { getPymthouseIssuerBase, getPymthouseOidcClientSecret, getPymthouseServiceToken, linkPymthouseUser } =
    await import('@/lib/pymthouse-oidc');

  if (!getPymthouseIssuerBase() || !getPymthouseOidcClientSecret()) {
    return null;
  }

  if (!naapUserId) {
    throw new Error('User must be logged in to link a PymtHouse billing provider');
  }

  const serviceToken = await getPymthouseServiceToken();
  const apiKey = await linkPymthouseUser(serviceToken, naapUserId, {
    email: userEmail ?? undefined,
  });
  return { apiKey };
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

    // ── PymtHouse: client credentials, no browser redirect ──────────────────
    // TODO: Once PymtHouse's developer_apps ownerId FK constraint is resolved,
    // replace the link-user call with the standard builder API:
    //   1. POST {base}/api/v1/apps/{PMTHOUSE_APP_ID}/users  (provision NaaP user)
    //   2. POST {base}/api/v1/apps/{PMTHOUSE_APP_ID}/users/{naapUserId}/token
    //      (issue user-scoped JWT: gateway + sign:job + discover:orchestrators)
    // Store the returned refresh_token (pmth_*) as the API key.
    // Env required: PMTHOUSE_APP_ID (developer app UUID from PymtHouse dashboard).
    // See: pymthouse/docs/builder-api.md + src/app/api/v1/apps/[id]/users/
    if (providerSlug === 'pymthouse') {
      let result: { apiKey: string } | null;
      try {
        result = await executePymthouseClientCredentials(
          naapUserId,
          authenticatedUser?.email,
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        console.error('[billing-auth:pymthouse] link-user error:', msg);
        return errors.badRequest(
          `PymtHouse user linking failed: ${msg}. ` +
            'Ensure PYMTHOUSE_ISSUER_URL (…/api/v1/oidc) and PMTHOUSE_CLIENT_SECRET are set, ' +
            'and run oidc:seed on PymtHouse (naap-service must have gateway scope).',
        );
      }

      if (!result) {
        return errors.badRequest(
          'PymtHouse is not configured. Set PYMTHOUSE_ISSUER_URL and PMTHOUSE_CLIENT_SECRET, then restart.',
        );
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
          accessToken: encryptToken(result.apiKey),
          providerUserId: naapUserId,
          redeemedAt: null,
          expiresAt: new Date(Date.now() + LOGIN_SESSION_TTL_MS),
        },
      });

      console.log(`[billing-auth:pymthouse] Linked user ${naapUserId?.slice(0, 8)}... session ${loginSessionId.slice(0, 8)}...`);

      return success({
        auth_url: null,
        api_key: result.apiKey,
        login_session_id: loginSessionId,
        expires_in: Math.floor(LOGIN_SESSION_TTL_MS / 1000),
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
