/**
 * POST /api/v1/auth/providers/:providerSlug/start
 * Start a brokered billing-provider authentication session.
 */

import * as crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { success, errors, getAuthToken } from '@/lib/api/response';
import { validateSession } from '@/lib/api/auth';
import { prisma } from '@/lib/db';
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

async function buildBillingAuthUrl(
  providerSlug: string,
  callbackUrl: string
): Promise<{ authUrl: string; pkceCodeVerifier: string | null } | null> {
  if (providerSlug === 'daydream') {
    const base = resolveProviderAuthUrl(providerSlug);
    if (!base) return null;
    const state = crypto.randomBytes(16).toString('hex');
    const authUrl = `${base}?redirect_url=${encodeURIComponent(callbackUrl)}&state=${encodeURIComponent(state)}`;
    return { authUrl, pkceCodeVerifier: null };
  }

  if (providerSlug === 'pymthouse') {
    const { generatePkcePair, buildPymthouseAuthorizeUrl, getPymthouseIssuerBase, getPymthouseOidcClientSecret } =
      await import('@/lib/pymthouse-oidc');
    if (!getPymthouseIssuerBase() || !getPymthouseOidcClientSecret()) {
      return null;
    }
    const state = crypto.randomBytes(16).toString('hex');
    const { codeVerifier, codeChallenge } = generatePkcePair();
    const authUrl = buildPymthouseAuthorizeUrl({
      redirectUri: callbackUrl,
      state,
      codeChallenge,
    });
    if (!authUrl) return null;
    return { authUrl, pkceCodeVerifier: codeVerifier };
  }

  return null;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ providerSlug: string }> }
): Promise<NextResponse> {
  try {
    const { providerSlug } = await params;

    const clientIp = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    if (!checkRateLimit(`billing-auth:${clientIp}`)) {
      return errors.tooManyRequests(
        'Too many authentication requests. Please try again later.'
      );
    }

    const body = await request.json().catch(() => ({}));
    const gatewayNonce = (body.gateway_nonce as string) || crypto.randomBytes(32).toString('hex');
    const gatewayInstanceId = (body.gateway_instance_id as string) || null;

    const authToken = getAuthToken(request);
    const authenticatedUser = authToken ? await validateSession(authToken) : null;
    const naapUserId = authenticatedUser?.id ?? null;

    const loginSessionId = crypto.randomBytes(32).toString('hex');

    // Build the callback URL that provider will redirect the browser to
    const appUrl = resolveBillingOAuthAppUrl(request);
    const callbackUrl = `${appUrl}/api/v1/auth/providers/${encodeURIComponent(providerSlug)}/callback`;

    const built = await buildBillingAuthUrl(providerSlug, callbackUrl);
    if (!built) {
      if (providerSlug === 'pymthouse') {
        return errors.badRequest(
          'PymtHouse OAuth is not configured. Set PYMTHOUSE_ISSUER_URL and NAAP_WEB_CLIENT_SECRET (and run pymthouse oidc:seed).'
        );
      }
      return errors.badRequest(`Unsupported billing provider for OAuth: ${providerSlug}`);
    }

    const { authUrl, pkceCodeVerifier } = built;
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
        pkceCodeVerifier,
        status: 'pending',
        accessToken: null,
        providerUserId: null,
        redeemedAt: null,
        expiresAt: new Date(Date.now() + LOGIN_SESSION_TTL_MS),
      },
    });

    console.log(`[billing-auth:${providerSlug}] Started login session ${loginSessionId.slice(0, 8)}...`);

    return success({
      auth_url: authUrl,
      login_session_id: loginSessionId,
      expires_in: Math.floor(LOGIN_SESSION_TTL_MS / 1000),
      poll_after_ms: 1500,
    });
  } catch (err) {
    console.error('[billing-auth] Error starting login:', err);
    return errors.internal('Failed to start billing provider login');
  }
}
