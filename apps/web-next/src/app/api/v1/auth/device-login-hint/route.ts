/**
 * GET /api/v1/auth/device-login-hint
 * One-shot read of HttpOnly `naap_device_login_hint` (set by middleware for PymtHouse device flow).
 * Clears the cookie in the response so the hint is not left on the client.
 */

import { NextRequest, NextResponse } from 'next/server';
import { success } from '@/lib/api/response';
import { NAAP_DEVICE_LOGIN_HINT_COOKIE } from '@/lib/pymthouse-device-initiate';

const clearHintCookie = (res: NextResponse): void => {
  res.cookies.set(NAAP_DEVICE_LOGIN_HINT_COOKIE, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 0,
    path: '/',
  });
};

export async function GET(request: NextRequest): Promise<NextResponse> {
  const raw = request.cookies.get(NAAP_DEVICE_LOGIN_HINT_COOKIE)?.value?.trim() ?? '';
  const res = success({ loginHint: raw.length > 0 ? raw : null });
  res.headers.set('Cache-Control', 'no-store');
  clearHintCookie(res);
  return res;
}
