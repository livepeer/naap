/**
 * POST /api/v1/auth/login
 * Login with email/password
 */

import { NextRequest } from 'next/server';
import { login } from '@/lib/api/auth';
import { success, errors, getClientIP } from '@/lib/api/response';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email, password } = body;

    if (!email || !password) {
      return errors.badRequest('Email and password are required');
    }

    const ipAddress = getClientIP(request);
    const result = await login(email, password, ipAddress);

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
    const error = err as Error & { code?: string; lockedUntil?: Date };

    if (error.code === 'ACCOUNT_LOCKED' && error.lockedUntil) {
      return errors.accountLocked(error.lockedUntil);
    }

    return errors.unauthorized(error.message || 'Invalid email or password');
  }
}
