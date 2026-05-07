/**
 * POST /api/v1/auth/pymthouse-device-approve
 * Consumes naap_pmth_device_approval cookie, runs Builder mint + RFC 8693 token exchange at PymtHouse, clears cookie.
 */

import { NextRequest, NextResponse } from 'next/server';
import { validateSessionWithExpiry } from '@/lib/api/auth';
import { getAuthToken, success, errors } from '@/lib/api/response';
import { approvePymthouseDeviceCode } from '@/lib/pymthouse-oidc';
import {
  NAAP_PMTH_DEVICE_APPROVAL_COOKIE,
  tryParseDeviceApprovalCookie,
} from '@/lib/pymthouse-device-initiate';

function withClearedDeviceCookie(res: NextResponse): NextResponse {
  res.cookies.set(NAAP_PMTH_DEVICE_APPROVAL_COOKIE, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 0,
    path: '/',
  });
  return res;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const token = getAuthToken(request);
  if (!token) {
    return errors.unauthorized('Not authenticated');
  }

  const session = await validateSessionWithExpiry(token);
  if (!session) {
    return errors.unauthorized('Invalid or expired session');
  }

  const payload = tryParseDeviceApprovalCookie(
    request.cookies.get(NAAP_PMTH_DEVICE_APPROVAL_COOKIE)?.value,
  );
  if (!payload) {
    return withClearedDeviceCookie(
      errors.badRequest('Missing or expired device approval cookie'),
    );
  }

  const result = await approvePymthouseDeviceCode({
    publicClientId: payload.publicClientId,
    userCode: payload.userCode,
    externalUserId: session.user.id,
    email: session.user.email ?? null,
  });

  if (result.ok) {
    return withClearedDeviceCookie(success({ status: 'authorized' as const }));
  }

  const errRes = NextResponse.json(
    {
      success: false,
      error: {
        code: 'PMTHOUSE_DEVICE_APPROVE_FAILED',
        message: result.message,
        status: result.status,
      },
      meta: { timestamp: new Date().toISOString() },
    },
    {
      status:
        result.status >= 400 && result.status < 600 ? result.status : 502,
    },
  );
  return withClearedDeviceCookie(errRes);
}
