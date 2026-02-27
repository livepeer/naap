/**
 * POST /api/v1/auth/verify-email
 * Verify email with token
 */

import {NextRequest, NextResponse } from 'next/server';
import { verifyEmail } from '@/lib/api/auth';
import { success, errors } from '@/lib/api/response';
import { enforceRateLimit } from '@/lib/api/rate-limit';

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const rateLimitResponse = enforceRateLimit(request, { keyPrefix: 'auth:verify-email' });
    if (rateLimitResponse) {
      return rateLimitResponse;
    }

    const body = await request.json();
    const { token } = body;

    if (!token || typeof token !== 'string') {
      return errors.badRequest('Verification token is required and must be a string');
    }

    const result = await verifyEmail(token);

    return success({
      user: result.user,
    });
  } catch {
    return errors.badRequest('Invalid or expired verification token');
  }
}
