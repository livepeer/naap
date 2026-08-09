/**
 * GET /api/v1/auth/mcp/complete
 *
 * Authenticated completion of the Storyboard MCP OAuth login bridge.
 * Reads the pending cookie set from `/login?mcp_oauth=1`, then redirects to
 * the allow-listed Storyboard callback with identity (never a composite).
 */

import { NextRequest, NextResponse } from 'next/server';

import { validateSessionWithExpiry } from '@/lib/api/auth';
import { getAuthToken } from '@/lib/api/response';
import {
  NAAP_MCP_OAUTH_PENDING_COOKIE,
  buildMcpOauthCallbackUrl,
  tryParseMcpOauthPendingCookie,
} from '@/lib/mcp-oauth-login-bridge';

function clearPending(res: NextResponse): NextResponse {
  res.cookies.set(NAAP_MCP_OAUTH_PENDING_COOKIE, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 0,
    path: '/',
  });
  return res;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const token = getAuthToken(request);
  if (!token) {
    const login = new URL('/login', request.url);
    login.searchParams.set('error', 'mcp_oauth_login_required');
    return NextResponse.redirect(login);
  }

  const session = await validateSessionWithExpiry(token);
  if (!session) {
    const login = new URL('/login', request.url);
    login.searchParams.set('error', 'mcp_oauth_login_required');
    return clearPending(NextResponse.redirect(login));
  }

  const pending = await tryParseMcpOauthPendingCookie(
    request.cookies.get(NAAP_MCP_OAUTH_PENDING_COOKIE)?.value,
  );
  if (!pending) {
    return clearPending(NextResponse.redirect(new URL('/dashboard', request.url)));
  }

  try {
    const target = await buildMcpOauthCallbackUrl({
      pending,
      externalUserId: session.user.id,
      email: session.user.email,
    });
    return clearPending(NextResponse.redirect(target));
  } catch (err) {
    console.error('[mcp-oauth-complete] failed to build callback', err);
    const login = new URL('/login', request.url);
    login.searchParams.set('error', 'mcp_oauth_failed');
    return clearPending(NextResponse.redirect(login));
  }
}
