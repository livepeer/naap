/**
 * GET /api/v1/auth/daydream/result?login_session_id=...
 * Poll the status of a brokered Daydream authentication session.
 *
 * Returns:
 *   { status: "pending" }                              - still waiting for user
 *   { status: "complete", access_token, user_id }      - first poll after callback
 *   { status: "redeemed" }                             - already consumed
 *   { status: "expired" }                              - TTL exceeded
 */

import { NextRequest } from 'next/server';
import { success, errors } from '@/lib/api/response';
import { daydreamLoginSessions } from '../_sessions';

export async function GET(request: NextRequest): Promise<ReturnType<typeof success>> {
  const loginSessionId = request.nextUrl.searchParams.get('login_session_id');

  if (!loginSessionId) {
    return errors.badRequest('login_session_id is required');
  }

  const session = daydreamLoginSessions.get(loginSessionId);
  if (!session) {
    return success({ status: 'expired' });
  }

  if (Date.now() > session.expiresAt) {
    daydreamLoginSessions.delete(loginSessionId);
    daydreamLoginSessions.delete(`state:${session.state}`);
    return success({ status: 'expired' });
  }

  if (session.status === 'complete') {
    if (session.redeemed) {
      return success({ status: 'redeemed' });
    }
    // Mark as redeemed (one-time consumption)
    session.redeemed = true;
    daydreamLoginSessions.set(loginSessionId, session);

    return success({
      status: 'complete',
      access_token: session.accessToken,
      user_id: session.userId,
      expires_in: Math.max(0, Math.floor((session.expiresAt - Date.now()) / 1000)),
    });
  }

  return success({ status: session.status });
}
