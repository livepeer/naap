/**
 * POST /api/v1/auth/refresh
 * Refresh session - extend expiration time
 */

import {NextRequest, NextResponse } from 'next/server';
import { refreshSession } from '@/lib/api/auth';
import { success, errors, getAuthToken } from '@/lib/api/response';

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const token = getAuthToken(request);

    if (!token) {
      return errors.unauthorized('No auth token provided');
    }

    const result = await refreshSession(token);

    if (!result) {
      return errors.unauthorized('Invalid or expired session');
    }

    return success({
      expiresAt: result.expiresAt.toISOString(),
    });
  } catch (err) {
    console.error('Session refresh error:', err);
    return errors.internal('Failed to refresh session');
  }
}
