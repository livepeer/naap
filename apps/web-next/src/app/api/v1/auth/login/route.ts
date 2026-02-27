/**
 * POST /api/v1/auth/login
 * Login with email/password
 */

import { NextRequest, NextResponse } from 'next/server';
import { login } from '@/lib/api/auth';
import { success, errors, getClientIP, isDatabaseError } from '@/lib/api/response';
import { enforceRateLimit } from '@/lib/api/rate-limit';

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const rateLimitResponse = enforceRateLimit(request, { keyPrefix: 'auth:login' });
    if (rateLimitResponse) {
      return rateLimitResponse;
    }

    const body = await request.json();
    const { email, password } = body;

    if (!email || typeof email !== 'string' || !password || typeof password !== 'string') {
      return errors.badRequest('Email and password are required and must be strings');
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
    // Surface database connection issues as 503 instead of misleading 401
    if (isDatabaseError(err)) {
      const dbErr = err as Error & { code?: string };
      console.error(`[AUTH] Database error: ${dbErr.name}: ${dbErr.message}`);
      return errors.serviceUnavailable(
        'Database is not available. Please try again later.'
      );
    }

    const error = err as Error & { code?: string };
    return errors.unauthorized(error.message || 'Invalid email or password');
  }
}
