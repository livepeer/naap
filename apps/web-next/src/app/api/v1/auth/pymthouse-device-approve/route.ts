/**
 * POST /api/v1/auth/pymthouse-device-approve
 * GET  /api/v1/auth/pymthouse-device-approve — returns pending userCode for consent UI display.
 */

import { NextRequest, NextResponse } from 'next/server';
import { PmtHouseError, toPmtHouseError } from '@pymthouse/builder-sdk';
import {
  isPymthouseConfigured,
  PYMTHOUSE_NOT_CONFIGURED_MESSAGE,
  readPymthouseEnv,
} from '@pymthouse/builder-sdk/config';
import { validateSessionWithExpiry } from '@/lib/api/auth';
import { validateCSRF } from '@/lib/api/csrf';
import { getAuthToken, success, errors } from '@/lib/api/response';
import { enforceRateLimit } from '@/lib/api/rate-limit';
import { getPmtHouseServerClient } from '@/lib/pymthouse-client';
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

export async function GET(request: NextRequest): Promise<NextResponse> {
  const token = getAuthToken(request);
  if (!token) {
    return errors.unauthorized('Not authenticated');
  }

  const session = await validateSessionWithExpiry(token);
  if (!session) {
    return errors.unauthorized('Invalid or expired session');
  }

  const payload = await tryParseDeviceApprovalCookie(
    request.cookies.get(NAAP_PMTH_DEVICE_APPROVAL_COOKIE)?.value,
  );
  if (!payload) {
    return errors.badRequest('No pending device approval found');
  }

  return success({ userCode: payload.userCode });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const token = getAuthToken(request);
  if (!token) {
    return errors.unauthorized('Not authenticated');
  }

  const csrfError = validateCSRF(request);
  if (csrfError) {
    return csrfError;
  }

  const session = await validateSessionWithExpiry(token);
  if (!session) {
    return errors.unauthorized('Invalid or expired session');
  }

  const rateLimitRes = enforceRateLimit(request, {
    keyPrefix: `device-approve:${session.user.id}`,
    windowMs: 60_000,
    maxRequests: 3,
  });
  if (rateLimitRes) {
    return rateLimitRes;
  }

  const payload = await tryParseDeviceApprovalCookie(
    request.cookies.get(NAAP_PMTH_DEVICE_APPROVAL_COOKIE)?.value,
  );
  if (!payload) {
    return withClearedDeviceCookie(
      errors.badRequest('Missing or expired device approval cookie'),
    );
  }

  if (!isPymthouseConfigured()) {
    return withClearedDeviceCookie(
      errors.internal(PYMTHOUSE_NOT_CONFIGURED_MESSAGE),
    );
  }

  const env = readPymthouseEnv();
  if (payload.publicClientId !== env?.publicClientId) {
    return withClearedDeviceCookie(
      errors.badRequest('publicClientId does not match PYMTHOUSE_PUBLIC_CLIENT_ID'),
    );
  }

  try {
    await getPmtHouseServerClient().approveDeviceLogin({
      externalUserId: session.user.id,
      userCode: payload.userCode,
      email: session.user.email ?? undefined,
      publicClientId: payload.publicClientId,
    });
    return withClearedDeviceCookie(success({ status: 'authorized' as const }));
  } catch (e) {
    const err =
      e instanceof PmtHouseError
        ? e
        : toPmtHouseError(e, 'Device approval token exchange failed');
    console.error('[pymthouse-device-approve] Upstream approval failed:', {
      message: err.message,
      status: err.status,
      code: err.code,
    });
    return withClearedDeviceCookie(
      errors.badRequest('Device approval failed. Please try again.'),
    );
  }
}
