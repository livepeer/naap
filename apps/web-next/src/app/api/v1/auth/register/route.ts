/**
 * POST /api/v1/auth/register
 * Register a new user with email/password
 */

import { NextRequest, NextResponse } from 'next/server';
import { register } from '@/lib/api/auth';
import { success, errors, isDatabaseError } from '@/lib/api/response';
import { enforceRateLimit } from '@/lib/api/rate-limit';

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const rateLimitResponse = enforceRateLimit(request, { keyPrefix: 'auth:register' });
    if (rateLimitResponse) {
      return rateLimitResponse;
    }

    const body = await request.json();
    const { email, password, displayName } = body;

    if (!email || !password) {
      return errors.badRequest('Email and password are required');
    }

    await register(email, password, displayName);

    return success({
      message: 'If the account can be registered, check your email for verification steps.',
    });
  } catch (err) {
    // Surface database connection issues as 503
    if (isDatabaseError(err)) {
      console.error('[AUTH] Database connection error:', (err as Error).message);
      return errors.serviceUnavailable(
        'Database is not available. Please configure DATABASE_URL or try again later.'
      );
    }

    return errors.badRequest('Registration failed');
  }
}
