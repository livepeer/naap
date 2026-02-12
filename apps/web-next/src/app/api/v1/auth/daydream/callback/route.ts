/**
 * GET /api/v1/auth/daydream/callback
 * Daydream redirects the browser here after the user authenticates.
 *
 * Query params from Daydream: ?token=...&userId=...&state=...
 *
 * This endpoint:
 * 1. Validates the state nonce against a pending login session
 * 2. Exchanges the short-lived Daydream token for a long-lived API key
 * 3. Stores the API key in DaydreamSettings for the NAAP user (if logged in)
 * 4. Marks the login session as complete so the gateway can poll the result
 * 5. Shows a "you can close this tab" page
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { validateSession } from '@/lib/api/auth';
import { getAuthToken } from '@/lib/api/response';
import { daydreamLoginSessions } from '../_sessions';

const DAYDREAM_API_BASE =
  process.env.DAYDREAM_API_BASE || 'https://api.daydream.live';

async function exchangeTokenForApiKey(token: string): Promise<string> {
  const response = await fetch(`${DAYDREAM_API_BASE}/v1/api-key`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ name: 'dd_naap_linked' }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Daydream token exchange failed: ${response.status} ${text}`);
  }

  const result = await response.json();
  return result.api_key || result.apiKey || result.key;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const searchParams = request.nextUrl.searchParams;
  const token = searchParams.get('token');
  const state = searchParams.get('state');
  const userId = searchParams.get('userId');

  // Build a simple HTML response for the browser tab
  const htmlResponse = (title: string, message: string, isError = false) =>
    new NextResponse(
      `<!DOCTYPE html>
<html><head><title>${title}</title>
<style>
  body { font-family: system-ui, sans-serif; display: flex; justify-content: center;
         align-items: center; min-height: 100vh; margin: 0; background: #0a0a0a; color: #fafafa; }
  .card { text-align: center; padding: 2rem; border-radius: 1rem;
          background: #1a1a1a; border: 1px solid ${isError ? '#ef4444' : '#22c55e'}; max-width: 400px; }
  h1 { font-size: 1.25rem; margin-bottom: 0.5rem; color: ${isError ? '#ef4444' : '#22c55e'}; }
  p { color: #a1a1aa; font-size: 0.9rem; }
</style></head>
<body><div class="card"><h1>${title}</h1><p>${message}</p></div></body></html>`,
      { status: isError ? 400 : 200, headers: { 'Content-Type': 'text/html' } }
    );

  if (!token || !state) {
    return htmlResponse(
      'Authentication Failed',
      'Missing token or state parameter from Daydream.',
      true
    );
  }

  // Look up session by state nonce
  const session = daydreamLoginSessions.get(`state:${state}`);
  if (!session) {
    return htmlResponse(
      'Session Expired',
      'The login session has expired or was already used. Please try again from Scope.',
      true
    );
  }

  try {
    // Exchange the short-lived token for a long-lived API key
    const apiKey = await exchangeTokenForApiKey(token);

    // Store in DaydreamSettings for initiating NAAP user.
    // Use session-bound user first (robust across cross-site redirects),
    // then fall back to cookie auth if available.
    let linkedNaapUserId = session.naapUserId;
    if (!linkedNaapUserId) {
      const naapToken = getAuthToken(request);
      const naapUser = naapToken ? await validateSession(naapToken) : null;
      linkedNaapUserId = naapUser?.id ?? null;
    }
    if (linkedNaapUserId) {
      await prisma.daydreamSettings.upsert({
        where: { userId: linkedNaapUserId },
        update: { apiKey },
        create: { userId: linkedNaapUserId, apiKey },
      });
      console.log(`[daydream-auth] Linked Daydream for NAAP user ${linkedNaapUserId}`);
    }

    // Mark the login session as complete so the gateway can poll the result
    session.status = 'complete';
    session.accessToken = apiKey;
    session.userId = userId;
    // Update both the primary and state-indexed entries
    daydreamLoginSessions.set(session.loginSessionId, session);
    daydreamLoginSessions.set(`state:${state}`, session);

    console.log(`[daydream-auth] Callback complete for session ${session.loginSessionId.slice(0, 8)}...`);

    return htmlResponse(
      'Daydream Linked',
      'Your Daydream account has been linked. You can close this tab and return to Scope.'
    );
  } catch (err) {
    console.error('[daydream-auth] Callback error:', err);
    return htmlResponse(
      'Linking Failed',
      err instanceof Error ? err.message : 'Failed to link Daydream account.',
      true
    );
  }
}
