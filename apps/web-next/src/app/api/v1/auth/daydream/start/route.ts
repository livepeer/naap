/**
 * POST /api/v1/auth/daydream/start
 * Start a brokered Daydream authentication session.
 *
 * Scope (or any local gateway) calls this to get an auth_url and login_session_id,
 * then opens the auth_url in a browser. The browser authenticates with Daydream and
 * is redirected back to /api/v1/auth/daydream/callback. The gateway polls
 * /api/v1/auth/daydream/result until the session completes.
 */

import * as crypto from 'crypto';
import { NextRequest } from 'next/server';
import { success, errors, getAuthToken } from '@/lib/api/response';
import { validateSession } from '@/lib/api/auth';
import { daydreamLoginSessions } from '../_sessions';

const DAYDREAM_AUTH_URL =
  process.env.DAYDREAM_AUTH_URL || 'https://app.daydream.live/sign-in/local';
const LOGIN_SESSION_TTL_MS = 10 * 60 * 1000; // 10 minutes

function resolveAppUrl(request: NextRequest): string {
  if (process.env.NEXT_PUBLIC_APP_URL) {
    return process.env.NEXT_PUBLIC_APP_URL;
  }
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`;
  }
  if (request.nextUrl?.origin) {
    return request.nextUrl.origin;
  }
  return 'http://localhost:3000';
}

export async function POST(request: NextRequest): Promise<ReturnType<typeof success>> {
  try {
    const body = await request.json().catch(() => ({}));
    const gatewayNonce = (body.gateway_nonce as string) || crypto.randomBytes(32).toString('hex');
    const gatewayInstanceId = (body.gateway_instance_id as string) || null;

    const authToken = getAuthToken(request);
    const authenticatedUser = authToken ? await validateSession(authToken) : null;
    const naapUserId = authenticatedUser?.id ?? null;

    const loginSessionId = crypto.randomBytes(32).toString('hex');

    // Build the callback URL that Daydream will redirect the browser to
    const appUrl = resolveAppUrl(request);
    const callbackUrl = `${appUrl}/api/v1/auth/daydream/callback`;

    const state = crypto.randomBytes(16).toString('hex');

    // Build auth URL with redirect back to NAAP callback
    const authUrl = `${DAYDREAM_AUTH_URL}?redirect_url=${encodeURIComponent(callbackUrl)}&state=${encodeURIComponent(state)}`;

    daydreamLoginSessions.set(loginSessionId, {
      loginSessionId,
      gatewayNonce,
      gatewayInstanceId,
      naapUserId,
      state,
      status: 'pending',
      accessToken: null,
      userId: null,
      createdAt: Date.now(),
      expiresAt: Date.now() + LOGIN_SESSION_TTL_MS,
      redeemed: false,
    });

    // Also store a reverse mapping from state -> loginSessionId so the callback can find it
    daydreamLoginSessions.set(`state:${state}`, {
      loginSessionId,
      gatewayNonce,
      gatewayInstanceId,
      naapUserId,
      state,
      status: 'pending',
      accessToken: null,
      userId: null,
      createdAt: Date.now(),
      expiresAt: Date.now() + LOGIN_SESSION_TTL_MS,
      redeemed: false,
    });

    console.log(`[daydream-auth] Started login session ${loginSessionId.slice(0, 8)}...`);

    return success({
      auth_url: authUrl,
      login_session_id: loginSessionId,
      expires_in: Math.floor(LOGIN_SESSION_TTL_MS / 1000),
      poll_after_ms: 1500,
    });
  } catch (err) {
    console.error('[daydream-auth] Error starting login:', err);
    return errors.internal('Failed to start Daydream login');
  }
}
