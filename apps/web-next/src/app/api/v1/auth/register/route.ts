/**
 * POST /api/v1/auth/register
 * Register a new user with email/password
 */

import {NextRequest, NextResponse } from 'next/server';
import { register } from '@/lib/api/auth';
import { success, errors } from '@/lib/api/response';

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await request.json();
    const { email, password, displayName } = body;

    if (!email || !password) {
      return errors.badRequest('Email and password are required');
    }

    const result = await register(email, password, displayName);

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
    const message = err instanceof Error ? err.message : 'Registration failed';

    if (message.includes('already registered')) {
      return errors.conflict(message);
    }

    return errors.badRequest(message);
  }
}
