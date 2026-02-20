/**
 * GET /api/v1/auth/providers/:providerSlug/result?login_session_id=...
 * Poll the status of a brokered billing-provider authentication session.
 */

import { NextRequest } from 'next/server';
import { validateSession } from '@/lib/api/auth';
import { success, errors, getAuthToken } from '@/lib/api/response';
import { prisma } from '@/lib/db';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ providerSlug: string }> }
): Promise<ReturnType<typeof success>> {
  const { providerSlug } = await params;
  const loginSessionId = request.nextUrl.searchParams.get('login_session_id');

  if (!loginSessionId) {
    return errors.badRequest('login_session_id is required');
  }

  const now = new Date();
  const session = await prisma.billingProviderOAuthSession.findUnique({
    where: { loginSessionId },
  });

  if (!session) {
    const response = success({ status: 'expired' });
    response.headers.set('Cache-Control', 'no-store');
    return response;
  }

  if (session.expiresAt <= now) {
    await prisma.billingProviderOAuthSession.delete({
      where: { loginSessionId },
    }).catch(() => null);
    const response = success({ status: 'expired' });
    response.headers.set('Cache-Control', 'no-store');
    return response;
  }

  if (session.providerSlug !== providerSlug) {
    return errors.forbidden('Session does not belong to this billing provider');
  }

  if (session.naapUserId) {
    const authToken = getAuthToken(request);
    const authenticatedUser = authToken ? await validateSession(authToken) : null;
    if (authenticatedUser?.id !== session.naapUserId) {
      return errors.forbidden('Session does not belong to this user');
    }
  }

  if (session.status === 'complete') {
    if (session.redeemedAt) {
      const response = success({ status: 'redeemed' });
      response.headers.set('Cache-Control', 'no-store');
      return response;
    }

    const [redeemResult] = await prisma.$transaction([
      prisma.billingProviderOAuthSession.updateMany({
        where: {
          loginSessionId,
          redeemedAt: null,
          status: 'complete',
          expiresAt: { gt: now },
        },
        data: { redeemedAt: now },
      }),
    ]);

    if (redeemResult.count !== 1) {
      const response = success({ status: 'redeemed' });
      response.headers.set('Cache-Control', 'no-store');
      return response;
    }

    const response = success({
      status: 'complete',
      access_token: session.accessToken,
      user_id: session.providerUserId,
      expires_in: Math.max(0, Math.floor((session.expiresAt.getTime() - Date.now()) / 1000)),
    });
    response.headers.set('Cache-Control', 'no-store');
    return response;
  }

  const response = success({ status: session.status });
  response.headers.set('Cache-Control', 'no-store');
  return response;
}
