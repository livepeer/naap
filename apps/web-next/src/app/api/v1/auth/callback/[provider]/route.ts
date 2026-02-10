/**
 * GET /api/v1/auth/callback/:provider
 * Handle OAuth callback
 */

import { NextRequest, NextResponse } from 'next/server';
import { handleOAuthCallback } from '@/lib/api/auth';

interface RouteParams {
  params: Promise<{ provider: string }>;
}

export async function GET(request: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  try {
    const { provider } = await params;

    if (provider !== 'google' && provider !== 'github') {
      return NextResponse.redirect(new URL('/login?error=invalid_provider', request.url));
    }

    const searchParams = request.nextUrl.searchParams;
    const code = searchParams.get('code');
    const state = searchParams.get('state');
    const errorParam = searchParams.get('error');

    // Check for OAuth error
    if (errorParam) {
      return NextResponse.redirect(new URL(`/login?error=${errorParam}`, request.url));
    }

    if (!code) {
      return NextResponse.redirect(new URL('/login?error=no_code', request.url));
    }

    // Verify state to prevent CSRF
    const storedState = request.cookies.get('oauth_state')?.value;
    if (!storedState || storedState !== state) {
      return NextResponse.redirect(new URL('/login?error=invalid_state', request.url));
    }

    // Handle the callback
    const result = await handleOAuthCallback(provider, code);

    // Redirect to dashboard with auth cookie
    const response = NextResponse.redirect(new URL('/dashboard', request.url));

    // Set auth cookie
    response.cookies.set('naap_auth_token', result.token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 7, // 7 days
      path: '/',
    });

    // Clear OAuth state cookie (must match sameSite used when setting it)
    response.cookies.set('oauth_state', '', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 0,
      path: '/',
    });

    return response;
  } catch (err) {
    console.error('OAuth callback error:', err);
    const message = err instanceof Error ? encodeURIComponent(err.message) : 'oauth_failed';
    return NextResponse.redirect(new URL(`/login?error=${message}`, request.url));
  }
}

/**
 * POST /api/v1/auth/callback/:provider
 * Handle OAuth callback (for frontend-initiated flows)
 */
export async function POST(request: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  try {
    const { provider } = await params;

    if (provider !== 'google' && provider !== 'github') {
      return NextResponse.json(
        { success: false, error: { code: 'INVALID_PROVIDER', message: 'Invalid OAuth provider' } },
        { status: 400 }
      );
    }

    const body = await request.json();
    const { code } = body;

    if (!code) {
      return NextResponse.json(
        { success: false, error: { code: 'NO_CODE', message: 'Authorization code is required' } },
        { status: 400 }
      );
    }

    // For POST requests, state verification is optional (handled by frontend)

    // Handle the callback
    const result = await handleOAuthCallback(provider, code);

    // Return response with auth cookie
    const response = NextResponse.json({
      success: true,
      data: {
        user: result.user,
        expiresAt: result.expiresAt.toISOString(),
      },
    });

    // Set auth cookie
    response.cookies.set('naap_auth_token', result.token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 7, // 7 days
      path: '/',
    });

    return response;
  } catch (err) {
    console.error('OAuth callback error:', err);
    const message = err instanceof Error ? err.message : 'OAuth authentication failed';
    return NextResponse.json(
      { success: false, error: { code: 'OAUTH_FAILED', message } },
      { status: 400 }
    );
  }
}
