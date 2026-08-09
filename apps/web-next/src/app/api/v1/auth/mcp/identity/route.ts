/**
 * POST /api/v1/auth/mcp/identity
 *
 * Exchange a short-lived signed MCP identity code (from the login-bridge
 * callback) for `{ externalUserId, email }`. Used by Storyboard's naap
 * BillingProvider when the callback does not already carry external_user_id.
 */

import { NextRequest, NextResponse } from 'next/server';

import { consumeMcpOauthIdentityCode } from '@/lib/mcp-oauth-login-bridge';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest): Promise<NextResponse> {
  let body: { code?: unknown };
  try {
    body = (await request.json()) as { code?: unknown };
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const code = typeof body.code === 'string' ? body.code.trim() : '';
  if (!code) {
    return NextResponse.json({ error: 'code_required' }, { status: 400 });
  }

  const identity = await consumeMcpOauthIdentityCode(code);
  if (!identity) {
    return NextResponse.json({ error: 'invalid_or_expired_code' }, { status: 401 });
  }

  const res = NextResponse.json({
    externalUserId: identity.externalUserId,
    email: identity.email,
  });
  res.headers.set('Cache-Control', 'no-store');
  return res;
}
