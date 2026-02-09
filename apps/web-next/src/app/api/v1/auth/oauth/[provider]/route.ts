/**
 * GET /api/v1/auth/oauth/:provider
 * Get OAuth authorization URL
 */

import { NextRequest } from 'next/server';
import { getOAuthUrl, generateCSRFToken } from '@/lib/api/auth';
import { success, errors } from '@/lib/api/response';

interface RouteParams {
  params: Promise<{ provider: string }>;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { provider } = await params;

    if (provider !== 'google' && provider !== 'github') {
      return errors.badRequest('Invalid OAuth provider');
    }

    // Generate state parameter for CSRF protection
    const state = generateCSRFToken();

    const url = getOAuthUrl(provider, state);

    if (!url) {
      return errors.badRequest(`OAuth provider ${provider} is not configured`);
    }

    // Store state in cookie for verification on callback
    const response = success({ url });

    response.cookies.set('oauth_state', state, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 10, // 10 minutes
      path: '/',
    });

    return response;
  } catch (err) {
    console.error('OAuth URL error:', err);
    return errors.internal('Failed to generate OAuth URL');
  }
}
