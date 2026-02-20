/**
 * GET /api/v1/auth/providers/:providerSlug/result?login_session_id=...
 * Poll the status of a brokered billing-provider authentication session.
 */

import { NextRequest, NextResponse } from 'next/server';
import { validateSession } from '@/lib/api/auth';
import { success, errors, getAuthToken } from '@/lib/api/response';
import { prisma } from '@/lib/db';
import { decryptToken } from '@naap/database';

let lastCleanup = 0;
const CLEANUP_INTERVAL_MS = 5 * 60_000;

async function cleanupExpiredSessions(): Promise<void> {
  const now = Date.now();
  if (now - lastCleanup < CLEANUP_INTERVAL_MS) return;
  lastCleanup = now;
  try {
    const { count } = await prisma.billingProviderOAuthSession.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });
    if (count > 0) {
      console.log(`[billing-auth] Cleaned up ${count} expired OAuth sessions`);
    }
  } catch {
    // non-critical
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ providerSlug: string }> }
): Promise<NextResponse> {
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

    const accessToken = session.accessToken ? decryptToken(session.accessToken) : null;
    if (!accessToken) {
      return errors.internal('Failed to retrieve access token');
    }

    const response = success({
      status: 'complete',
      access_token: accessToken,
      user_id: session.providerUserId,
      expires_in: Math.max(0, Math.floor((session.expiresAt.getTime() - Date.now()) / 1000)),
    });
    response.headers.set('Cache-Control', 'no-store');
    return response;
  }

  // Opportunistic cleanup of expired sessions (non-blocking)
  cleanupExpiredSessions().catch(() => null);

  const response = success({ status: session.status });
  response.headers.set('Cache-Control', 'no-store');
  return response;
}
