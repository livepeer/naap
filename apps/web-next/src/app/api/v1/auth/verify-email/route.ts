/**
 * POST /api/v1/auth/verify-email
 * Verify email with token
 */

import {NextRequest, NextResponse } from 'next/server';
import { verifyEmail } from '@/lib/api/auth';
import { success, errors } from '@/lib/api/response';

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await request.json();
    const { token } = body;

    if (!token) {
      return errors.badRequest('Verification token is required');
    }

    const result = await verifyEmail(token);

    return success({
      user: result.user,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Email verification failed';
    return errors.badRequest(message);
  }
}
