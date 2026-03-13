/**
 * POST /api/v1/auth/providers/:providerSlug/start
 * Start a brokered billing-provider authentication session.
 * Supports both legacy OAuth and OIDC auth flows.
 */

import * as crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { success, errors, getAuthToken } from '@/lib/api/response';
import { validateSession } from '@/lib/api/auth';
import { resolveAppUrl } from '@/lib/api/resolve-app-url';
import { prisma } from '@/lib/db';
import {
  fetchDiscoveryDocument,
  generateCodeVerifier,
  generateCodeChallenge,
  generateNonce,
  encryptToken,
} from '@naap/database';

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

async function buildOidcAuthorizeUrl(
  providerConfig: { oidcDiscoveryUrl?: string | null; oidcClientId?: string | null; oidcScopes?: string | null },
  callbackUrl: string,
  state: string,
  nonce: string,
  codeChallenge: string
): Promise<string> {
  const discoveryUrl = providerConfig.oidcDiscoveryUrl;
  if (!discoveryUrl) {
    throw new Error('OIDC discovery URL not configured for provider');
  }

  const discovery = await fetchDiscoveryDocument(discoveryUrl);
  const authEndpoint = discovery.authorization_endpoint;

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: providerConfig.oidcClientId || '',
    redirect_uri: callbackUrl,
    scope: providerConfig.oidcScopes || 'openid profile email',
    state,
    nonce,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });

  return `${authEndpoint}?${params.toString()}`;
}

function buildLegacyOauthUrl(
  providerSlug: string,
  callbackUrl: string,
  state: string
): string | null {
  if (providerSlug === 'daydream') {
    return `${DAYDREAM_AUTH_URL}?redirect_url=${encodeURIComponent(callbackUrl)}&state=${encodeURIComponent(state)}`;
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
      return errors.tooManyRequests
        ? errors.tooManyRequests('Too many authentication requests. Please try again later.')
        : new NextResponse(
            JSON.stringify({ success: false, error: { code: 'RATE_LIMITED', message: 'Too many authentication requests. Please try again later.' } }),
            { status: 429, headers: { 'Content-Type': 'application/json', 'Retry-After': '60' } }
          );
    }

    const providerConfig = await prisma.billingProvider.findUnique({ where: { slug: providerSlug } });
    if (!providerConfig || !providerConfig.enabled) {
      return errors.badRequest(`Unsupported or disabled billing provider: ${providerSlug}`);
    }

    const body = await request.json().catch(() => ({}));
    const gatewayNonce = (body.gateway_nonce as string) || crypto.randomBytes(32).toString('hex');
    const gatewayInstanceId = (body.gateway_instance_id as string) || null;

    const authToken = getAuthToken(request);
    const authenticatedUser = authToken ? await validateSession(authToken) : null;
    const naapUserId = authenticatedUser?.id ?? null;

    const loginSessionId = crypto.randomBytes(32).toString('hex');
    const appUrl = resolveAppUrl(request, providerConfig.callbackOrigin);
    const callbackUrl = `${appUrl}/api/v1/auth/providers/${encodeURIComponent(providerSlug)}/callback`;
    const state = crypto.randomBytes(16).toString('hex');

    let authUrl: string;
    let nonce: string | null = null;
    let codeVerifier: string | null = null;

    if (providerConfig.authType === 'oidc') {
      // OIDC flow with PKCE
      nonce = generateNonce();
      codeVerifier = generateCodeVerifier();
      const codeChallenge = generateCodeChallenge(codeVerifier);

      authUrl = await buildOidcAuthorizeUrl(
        providerConfig,
        callbackUrl,
        state,
        nonce,
        codeChallenge
      );

      console.log(`[billing-auth:${providerSlug}] Starting OIDC flow for session ${loginSessionId.slice(0, 8)}...`);
    } else {
      // Legacy OAuth flow
      const legacyUrl = buildLegacyOauthUrl(providerSlug, callbackUrl, state);
      if (!legacyUrl) {
        return errors.badRequest(`Unsupported billing provider for OAuth: ${providerSlug}`);
      }
      authUrl = legacyUrl;

      console.log(`[billing-auth:${providerSlug}] Starting legacy OAuth flow for session ${loginSessionId.slice(0, 8)}...`);
    }

    // Store session with OIDC-specific fields
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
        nonce,
        codeVerifier: codeVerifier ? encryptToken(codeVerifier) : null,
        idTokenSub: null,
        idTokenClaims: null,
      },
    });

    return success({
      auth_url: authUrl,
      login_session_id: loginSessionId,
      expires_in: Math.floor(LOGIN_SESSION_TTL_MS / 1000),
      poll_after_ms: 1500,
      auth_type: providerConfig.authType,
    });
  } catch (err) {
    console.error('[billing-auth] Error starting login:', err);
    return errors.internal('Failed to start billing provider login');
  }
}
