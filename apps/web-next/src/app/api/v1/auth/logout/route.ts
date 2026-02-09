/**
 * POST /api/v1/auth/logout
 * Logout - revoke session
 */

import { NextRequest } from 'next/server';
import { logout } from '@/lib/api/auth';
import { successNoContent, getAuthToken } from '@/lib/api/response';

export async function POST(request: NextRequest) {
  try {
    const token = getAuthToken(request);

    if (token) {
      await logout(token);
    }

    // Clear auth cookie
    const response = successNoContent();
    response.cookies.set('naap_auth_token', '', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 0,
      path: '/',
    });

    return response;
  } catch {
    // Even if logout fails, clear the cookie
    const response = successNoContent();
    response.cookies.set('naap_auth_token', '', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 0,
      path: '/',
    });

    return response;
  }
}
