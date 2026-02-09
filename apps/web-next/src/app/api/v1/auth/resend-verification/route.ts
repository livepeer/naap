/**
 * POST /api/v1/auth/resend-verification
 * Resend email verification
 */

import { NextRequest } from 'next/server';
import { resendVerificationEmail } from '@/lib/api/auth';
import { success, errors } from '@/lib/api/response';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email } = body;

    if (!email) {
      return errors.badRequest('Email is required');
    }

    await resendVerificationEmail(email);

    return success({
      message: 'Verification email sent',
    });
  } catch (err) {
    console.error('Resend verification error:', err);
    // Don't reveal the actual error to prevent email enumeration
    return success({
      message: 'Verification email sent',
    });
  }
}
