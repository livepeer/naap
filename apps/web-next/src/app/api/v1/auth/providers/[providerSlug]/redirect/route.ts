/**
 * GET /api/v1/auth/providers/:providerSlug/redirect?login_session_id=...
 *
 * Server-side resolver for the billing provider authorization URL. The browser
 * only opens this same-origin route; the trusted provider URL is built here
 * from environment configuration plus the persisted OAuth session state. This
 * keeps any remote-controlled string out of `window.open` on the client.
 */

import { NextRequest, NextResponse } from 'next/server';
import { errors } from '@/lib/api/response';
import { prisma } from '@/lib/db';
import { resolveBillingOAuthAppUrl } from '@/lib/billing-oauth-origin';
import { getRedirectFlowBillingProvider } from '@/lib/billing-providers';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ providerSlug: string }> },
): Promise<NextResponse> {
  const { providerSlug } = await params;

  const providerConfig = getRedirectFlowBillingProvider(providerSlug);
  if (!providerConfig) {
    return errors.badRequest(`Unsupported billing provider for redirect: ${providerSlug}`);
  }

  const loginSessionId = request.nextUrl.searchParams.get('login_session_id');
  if (!loginSessionId || !/^[a-f0-9]{64}$/i.test(loginSessionId)) {
    return errors.badRequest('Missing or malformed login_session_id');
  }

  const session = await prisma.billingProviderOAuthSession.findUnique({
    where: { loginSessionId },
  });
  if (!session || session.providerSlug !== providerSlug || session.status !== 'pending') {
    return errors.badRequest('Invalid or already-redeemed login session');
  }
  if (Date.now() >= new Date(session.expiresAt).getTime()) {
    return errors.badRequest('Login session expired');
  }

  const appUrl = resolveBillingOAuthAppUrl(request);
  const callbackUrl = `${appUrl}/api/v1/auth/providers/${encodeURIComponent(providerSlug)}/callback`;

  const target = new URL(providerConfig.authUrl);
  target.searchParams.set('redirect_url', callbackUrl);
  target.searchParams.set('state', session.state);

  const response = NextResponse.redirect(target.toString(), 302);
  response.headers.set('Cache-Control', 'no-store');
  return response;
}
