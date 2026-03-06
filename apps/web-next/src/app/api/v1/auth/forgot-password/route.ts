/**
 * POST /api/v1/auth/forgot-password
 * Request password reset email
 */

import {NextRequest, NextResponse } from 'next/server';
import { requestPasswordReset } from '@/lib/api/auth';
import { success, errors } from '@/lib/api/response';
import { applyRateLimit, rateLimiters } from '@/lib/rateLimit';

export async function POST(request: NextRequest): Promise<NextResponse | Response> {
  // Rate limit: 3 requests per 15 minutes per IP
  const limited = await applyRateLimit(request, rateLimiters.forgotPassword);
  if (limited) return limited;

  try {
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
    return success({
      message: 'If an account exists, a reset link has been sent.',
    });
  }
}
