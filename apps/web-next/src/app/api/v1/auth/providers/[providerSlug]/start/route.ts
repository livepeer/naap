/**
 * POST /api/v1/auth/providers/:providerSlug/start
 * Start a brokered billing-provider authentication session.
 */

import * as crypto from 'crypto';
import { NextRequest } from 'next/server';
import { success, errors, getAuthToken } from '@/lib/api/response';
import { validateSession } from '@/lib/api/auth';
import { billingProviderLoginSessions } from '../../_sessions';

const DAYDREAM_AUTH_URL =
  process.env.DAYDREAM_AUTH_URL || 'https://app.daydream.live/sign-in/local';
const LOGIN_SESSION_TTL_MS = 10 * 60 * 1000; // 10 minutes

function firstHeaderValue(value: string | null): string | null {
  if (!value) {
    return null;
  }
  const first = value.split(',')[0]?.trim();
  return first || null;
}

function resolveAppUrl(request: NextRequest): string {
  const forwardedHost = firstHeaderValue(request.headers.get('x-forwarded-host'));
  const forwardedProto = firstHeaderValue(request.headers.get('x-forwarded-proto'));
  if (forwardedHost) {
    const protocol =
      forwardedProto ||
      (forwardedHost.includes('localhost') || forwardedHost.startsWith('127.') ? 'http' : 'https');
    return `${protocol}://${forwardedHost}`;
  }

  const host = firstHeaderValue(request.headers.get('host'));
  if (host) {
    const protocol =
      forwardedProto ||
      (host.includes('localhost') || host.startsWith('127.') ? 'http' : 'https');
    return `${protocol}://${host}`;
  }

  if (request.nextUrl?.origin) {
    return request.nextUrl.origin;
  }
  if (process.env.NEXT_PUBLIC_APP_URL) {
    return process.env.NEXT_PUBLIC_APP_URL;
  }
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`;
  }
  return 'http://localhost:3000';
}

function resolveProviderAuthUrl(providerSlug: string): string | null {
  if (providerSlug === 'daydream') {
    return DAYDREAM_AUTH_URL;
  }
  return null;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ providerSlug: string }> }
): Promise<ReturnType<typeof success>> {
  try {
    const { providerSlug } = await params;
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

    const session = {
      loginSessionId,
      providerSlug,
      gatewayNonce,
      gatewayInstanceId,
      naapUserId,
      state,
      status: 'pending' as const,
      accessToken: null,
      userId: null,
      createdAt: Date.now(),
      expiresAt: Date.now() + LOGIN_SESSION_TTL_MS,
      redeemed: false,
    };

    billingProviderLoginSessions.set(loginSessionId, session);

    // Also store a reverse mapping from state -> loginSessionId so the callback can find it
    billingProviderLoginSessions.set(`state:${state}`, session);

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
