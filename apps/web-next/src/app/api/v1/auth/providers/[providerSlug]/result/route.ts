/**
 * GET /api/v1/auth/providers/:providerSlug/result?login_session_id=...
 * Poll the status of a brokered billing-provider authentication session.
 */

import { NextRequest } from 'next/server';
import { validateSession } from '@/lib/api/auth';
import { success, errors, getAuthToken } from '@/lib/api/response';
import { billingProviderLoginSessions } from '../../_sessions';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ providerSlug: string }> }
): Promise<ReturnType<typeof success>> {
  const { providerSlug } = await params;
  const loginSessionId = request.nextUrl.searchParams.get('login_session_id');

  if (!loginSessionId) {
    return errors.badRequest('login_session_id is required');
  }

  const session = billingProviderLoginSessions.get(loginSessionId);
  if (!session) {
    return success({ status: 'expired' });
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

  // Re-fetch the session after the await to ensure it hasn't expired or been deleted
  const currentSession = billingProviderLoginSessions.get(loginSessionId);
  if (!currentSession) {
    return success({ status: 'expired' });
  }

  if (currentSession.providerSlug !== providerSlug) {
    return errors.forbidden('Session does not belong to this billing provider');
  }

  if (currentSession.status === 'complete') {
    if (!billingProviderLoginSessions.markRedeemed(loginSessionId)) {
      return success({ status: 'redeemed' });
    }

    return success({
      status: 'complete',
      access_token: currentSession.accessToken,
      user_id: currentSession.userId,
      expires_in: Math.max(0, Math.floor((currentSession.expiresAt - Date.now()) / 1000)),
    });
  }

  return success({ status: currentSession.status });
}
