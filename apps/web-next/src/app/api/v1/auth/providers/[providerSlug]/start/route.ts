/**
 * POST /api/v1/auth/providers/:providerSlug/start
 * Start a brokered billing-provider authentication session.
 */

import * as crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { success, errors, getAuthToken } from '@/lib/api/response';
import { validateSession } from '@/lib/api/auth';
import { prisma } from '@/lib/db';

const DAYDREAM_AUTH_URL =
  process.env.DAYDREAM_AUTH_URL || 'https://app.daydream.live/sign-in/local';
const PYMTHOUSE_AUTH_URL =
  process.env.PYMTHOUSE_AUTH_URL || 'http://localhost:3001/naap-link';
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

function firstHeaderValue(value: string | null): string | null {
  if (!value) {
    return null;
  }
  const first = value.split(',')[0]?.trim();
  return first || null;
}

function resolveAppUrl(request: NextRequest): string {
  const isProduction =
    process.env.NODE_ENV === 'production' || process.env.VERCEL_ENV === 'production';

  // Dedicated override for OAuth callback origin (e.g. local dev through a plugin shell)
  if (isProduction) {
    if (!process.env.BILLING_PROVIDER_OAUTH_CALLBACK_ORIGIN) {
      throw new Error('BILLING_PROVIDER_OAUTH_CALLBACK_ORIGIN must be set in production');
    }
    return process.env.BILLING_PROVIDER_OAUTH_CALLBACK_ORIGIN;
  }

  if (process.env.BILLING_PROVIDER_OAUTH_CALLBACK_ORIGIN) {
    return process.env.BILLING_PROVIDER_OAUTH_CALLBACK_ORIGIN;
  }

  const host = firstHeaderValue(request.headers.get('host'));
  const forwardedHost = firstHeaderValue(request.headers.get('x-forwarded-host'));
  const forwardedProto = firstHeaderValue(request.headers.get('x-forwarded-proto'));

  const isLocalHost = (value: string): boolean =>
    value.includes('localhost') ||
    value.startsWith('127.') ||
    value.startsWith('0.0.0.0') ||
    value.startsWith('[::1]');

  if (host) {
    const useForwardedHost = isLocalHost(host) && !!forwardedHost;
    const resolvedHost = useForwardedHost ? (forwardedHost as string) : host;

    const protocol = isLocalHost(resolvedHost)
      ? (forwardedProto || 'http')
      : 'https';

    return `${protocol}://${resolvedHost}`;
  }

  // Last-resort/dev fallback: only trust forwarded headers for localhost/127.*
  if (forwardedHost && isLocalHost(forwardedHost)) {
    const protocol = forwardedProto || 'http';
    return `${protocol}://${forwardedHost}`;
  }

  return 'http://localhost:3000';
}

function resolveProviderAuthUrl(providerSlug: string): string | null {
  if (providerSlug === 'daydream') {
    return DAYDREAM_AUTH_URL;
  }
  if (providerSlug === 'pymthouse') {
    return PYMTHOUSE_AUTH_URL;
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

    const providerAuthUrl = resolveProviderAuthUrl(providerSlug);
    if (!providerAuthUrl) {
      return errors.badRequest(`Unsupported billing provider for OAuth: ${providerSlug}`);
    }

    const body = await request.json().catch(() => ({}));
    const gatewayNonce = (body.gateway_nonce as string) || crypto.randomBytes(32).toString('hex');
    const gatewayInstanceId = (body.gateway_instance_id as string) || null;

    const authToken = getAuthToken(request);
    const authenticatedUser = authToken ? await validateSession(authToken) : null;
    const naapUserId = authenticatedUser?.id ?? null;

    const loginSessionId = crypto.randomBytes(32).toString('hex');

    // Build the callback URL that provider will redirect the browser to
    const appUrl = resolveAppUrl(request);
    const callbackUrl = `${appUrl}/api/v1/auth/providers/${encodeURIComponent(providerSlug)}/callback`;

    const state = crypto.randomBytes(16).toString('hex');

    // Build auth URL with redirect back to NAAP callback
    const authUrl = `${providerAuthUrl}?redirect_url=${encodeURIComponent(callbackUrl)}&state=${encodeURIComponent(state)}`;
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
