/**
 * POST/GET /api/v1/auth/logout
 * Logout - revoke session and clear all auth state
 * 
 * Gracefully handles:
 * - Valid sessions (revokes token server-side)
 * - Invalid/expired sessions (just clears cookies)
 * - Missing tokens (just clears cookies)
 * - Server errors (still clears cookies)
 */

import { NextRequest, NextResponse } from 'next/server';
import { logout } from '@/lib/api/auth';
import { successNoContent, getAuthToken } from '@/lib/api/response';
import { validateCSRF } from '@/lib/api/csrf';

/**
 * Clear all auth-related cookies consistently.
 * All auth cookies use sameSite: 'lax' for consistency across OAuth and regular login flows.
 */
function clearAuthCookies(response: NextResponse): void {
  const cookieOptions = {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 0,
    path: '/',
  } as const;

  response.cookies.set('naap_auth_token', '', cookieOptions);
  response.cookies.set('naap_csrf_token', '', cookieOptions);
}

async function handleLogout(request: NextRequest): Promise<NextResponse> {
  const csrfError = validateCSRF(request, { shadowMode: true });
  if (csrfError) return csrfError;

  const response = successNoContent();
  
  // Always clear cookies first, regardless of what happens with server-side logout
  clearAuthCookies(response);

  // Attempt to revoke the session server-side (non-blocking for the response)
  try {
    const token = getAuthToken(request);
    if (token) {
      // Fire and forget - don't let server errors block cookie clearing
      await logout(token).catch(() => {
        // Silently ignore - token may already be invalid/expired
      });
    }
  } catch {
    // Silently ignore any errors - cookies are already cleared
  }

  return response;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  return handleLogout(request);
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  return handleLogout(request);
}
