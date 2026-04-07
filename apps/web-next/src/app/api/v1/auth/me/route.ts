/**
 * GET /api/v1/auth/me
 * Get current user and CSRF token
 */

import {NextRequest, NextResponse } from 'next/server';
import { validateSessionWithExpiry } from '@/lib/api/auth';
import { success, errors, getAuthToken } from '@/lib/api/response';
import { createSessionCSRFToken } from '@/lib/api/csrf';

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const token = getAuthToken(request);

    if (!token) {
      return errors.unauthorized('No auth token provided');
    }

    const result = await validateSessionWithExpiry(token);

    if (!result) {
      return errors.unauthorized('Invalid or expired session');
    }

    // Generate CSRF token tied to this session
    const csrfToken = createSessionCSRFToken(token);

    return success({
      user: result.user,
      expiresAt: result.expiresAt.toISOString(),
      csrfToken,
    });
  } catch (err) {
    console.error('Auth me error:', err);
    return errors.internal('Failed to get user info');
  }
}
