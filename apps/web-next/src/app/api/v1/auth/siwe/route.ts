/**
 * POST /api/v1/auth/siwe
 * Sign In With Ethereum (SIWE) authentication
 * Verifies JWT from jwt-issuer and creates/links naap account
 */

import { NextRequest, NextResponse } from 'next/server';
import { loginWithSIWE } from '../../../../../lib/api/auth';
import { success, errors, isDatabaseError } from '../../../../../lib/api/response';

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await request.json();
    const { address, signature, jwt } = body;

    if (!address) {
      return errors.badRequest('Wallet address is required');
    }

    if (!jwt) {
      return errors.badRequest('JWT token from jwt-issuer is required');
    }

    const result = await loginWithSIWE(address, jwt);

    // Set auth cookie
    const response = success({
      user: result.user,
      token: result.token, // Include token in response for client-side storage
      expiresAt: result.expiresAt.toISOString(),
    });

    response.cookies.set('naap_auth_token', result.token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 60 * 60 * 24 * 7, // 7 days
      path: '/',
    });

    return response;
  } catch (err) {
    // Surface database connection issues as 503 instead of misleading 401
    if (isDatabaseError(err)) {
      const dbErr = err as Error & { code?: string };
      console.error(`[AUTH] Database error: ${dbErr.name}: ${dbErr.message}`);
      return errors.serviceUnavailable(
        'Database is not available. Please try again later.'
      );
    }

    const error = err as Error;
    console.error('[AUTH] SIWE login error:', error);
    return errors.unauthorized(error.message || 'SIWE authentication failed');
  }
}
