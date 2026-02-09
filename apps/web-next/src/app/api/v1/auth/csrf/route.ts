import { NextRequest, NextResponse } from 'next/server';
import { generateCsrfToken } from '@/lib/api/csrf';

/**
 * GET /api/v1/auth/csrf
 * Generate and return a CSRF token.
 * The token is also set as a cookie for double-submit verification.
 */
export async function GET(request: NextRequest) {
  const token = generateCsrfToken();
  
  const response = NextResponse.json({
    success: true,
    data: { token },
  });

  // Set the CSRF token as a cookie for double-submit verification
  response.cookies.set('naap_csrf_token', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
    maxAge: 60 * 60, // 1 hour
  });

  return response;
}
