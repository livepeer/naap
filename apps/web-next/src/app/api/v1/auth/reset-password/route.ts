/**
 * POST /api/v1/auth/reset-password
 * Reset password with token
 */

import { NextRequest } from 'next/server';
import { resetPassword } from '@/lib/api/auth';
import { success, errors } from '@/lib/api/response';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { token, password } = body;

    if (!token || !password) {
      return errors.badRequest('Token and password are required');
    }

    const result = await resetPassword(token, password);

    // Set auth cookie
    const response = success({
      user: result.user,
      token: result.token, // Include token in response for client-side storage
      expiresAt: result.expiresAt.toISOString(),
    });

    response.cookies.set('naap_auth_token', result.token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 60 * 60 * 24 * 7, // 7 days
      path: '/',
    });

    return response;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Password reset failed';
    return errors.badRequest(message);
  }
}
