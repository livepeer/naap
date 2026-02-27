/**
 * POST /api/v1/auth/forgot-password
 * Request password reset email
 */

import {NextRequest, NextResponse } from 'next/server';
import { requestPasswordReset } from '@/lib/api/auth';
import { success, errors } from '@/lib/api/response';
import { enforceRateLimit } from '@/lib/api/rate-limit';

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const rateLimitResponse = enforceRateLimit(request, { keyPrefix: 'auth:forgot-password' });
    if (rateLimitResponse) {
      return rateLimitResponse;
    }

    const body = await request.json();
    const { email } = body;

    if (!email) {
      return errors.badRequest('Email is required');
    }

    const result = await requestPasswordReset(email);

    return success({
      message: result.message,
    });
  } catch (err) {
    console.error('Forgot password error:', err);
    // Don't reveal the actual error to prevent email enumeration
    return success({
      message: 'If an account exists, a reset link has been sent.',
    });
  }
}
