/**
 * GET /api/v1/auth/providers/:providerSlug/callback
 * Provider redirects the browser here after user authentication.
 * Supports both legacy OAuth (token param) and OIDC (code param) flows.
 */

import { NextRequest, NextResponse } from 'next/server';
import { resolveAppUrl } from '@/lib/api/resolve-app-url';
import { prisma } from '@/lib/db';
import {
  encryptToken,
  decryptToken,
  fetchDiscoveryDocument,
  exchangeCodeForTokens,
  validateIdToken,
  type IdTokenPayload,
} from '@naap/database';

const DAYDREAM_API_BASE = process.env.DAYDREAM_API_BASE || 'https://api.daydream.live';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}


async function exchangeTokenForApiKey(providerSlug: string, token: string): Promise<string> {
  if (providerSlug !== 'daydream') {
    throw new Error(`Unsupported billing provider for OAuth callback: ${providerSlug}`);
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10_000);
  let response: Response;
  try {
    response = await fetch(`${DAYDREAM_API_BASE}/v1/api-key`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ name: 'dd_naap_linked' }),
      signal: controller.signal,
    });
  } catch (err) {
    if ((err as { name?: string })?.name === 'AbortError') {
      throw new Error('Daydream token exchange timed out');
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Daydream token exchange failed: ${response.status} ${text}`);
  }

  const result = await response.json();
  const apiKey = result.api_key || result.apiKey || result.key;
  if (!apiKey) {
    throw new Error('Daydream token exchange failed: no API key in response');
  }
  return apiKey;
}

async function handleOidcCallback(
  providerConfig: { oidcDiscoveryUrl?: string | null; oidcClientId?: string | null; oidcClientSecret?: string | null },
  code: string,
  redirectUri: string,
  session: {
    loginSessionId: string;
    nonce: string | null;
    codeVerifier: string | null;
  }
): Promise<{ accessToken: string; idTokenClaims: IdTokenPayload }> {
  const discoveryUrl = providerConfig.oidcDiscoveryUrl;
  if (!discoveryUrl) {
    throw new Error('OIDC discovery URL not configured');
  }

  const discovery = await fetchDiscoveryDocument(discoveryUrl);

  const codeVerifier = session.codeVerifier ? decryptToken(session.codeVerifier) : undefined;

  const tokens = await exchangeCodeForTokens({
    tokenEndpoint: discovery.token_endpoint,
    code,
    redirectUri,
    clientId: providerConfig.oidcClientId || '',
    clientSecret: providerConfig.oidcClientSecret || undefined,
    codeVerifier,
  });

  if (!tokens.id_token) {
    throw new Error('No id_token in token response');
  }

  const idTokenClaims = await validateIdToken(tokens.id_token, {
    discoveryUrl,
    clientId: providerConfig.oidcClientId || '',
    nonce: session.nonce || undefined,
  });

  return {
    accessToken: tokens.access_token,
    idTokenClaims,
  };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ providerSlug: string }> }
): Promise<NextResponse> {
  const { providerSlug } = await params;
  const searchParams = request.nextUrl.searchParams;

  const code = searchParams.get('code');
  const token = searchParams.get('token');
  const state = searchParams.get('state');
  const error = searchParams.get('error');
  const errorDescription = searchParams.get('error_description');

  const htmlResponse = (title: string, message: string, isError = false) => {
    const safeTitle = escapeHtml(title);
    const safeMessage = escapeHtml(message);
    return new NextResponse(
      `<!DOCTYPE html>
<html><head><title>${safeTitle}</title>
<style>
  body { font-family: system-ui, sans-serif; display: flex; justify-content: center;
         align-items: center; min-height: 100vh; margin: 0; background: #0a0a0a; color: #fafafa; }
  .card { text-align: center; padding: 2rem; border-radius: 1rem;
          background: #1a1a1a; border: 1px solid ${isError ? '#ef4444' : '#22c55e'}; max-width: 400px; }
  h1 { font-size: 1.25rem; margin-bottom: 0.5rem; color: ${isError ? '#ef4444' : '#22c55e'}; }
  p { color: #a1a1aa; font-size: 0.9rem; }
</style>
${!isError ? '<script>setTimeout(function(){ window.close(); }, 3000);</script>' : ''}
</head>
<body><div class="card"><h1>${safeTitle}</h1><p>${safeMessage}</p></div></body></html>`,
      { status: isError ? 400 : 200, headers: { 'Content-Type': 'text/html' } }
    );
  };

  // Handle OIDC error response
  if (error) {
    console.error(`[billing-auth:${providerSlug}] OIDC error: ${error} - ${errorDescription}`);
    return htmlResponse(
      'Authentication Failed',
      errorDescription || error,
      true
    );
  }

  if (!state) {
    return htmlResponse(
      'Authentication Failed',
      'Missing state parameter from provider.',
      true
    );
  }

  const session = await prisma.billingProviderOAuthSession.findUnique({
    where: { state },
  });
  if (!session) {
    return htmlResponse(
      'Session Expired',
      'The login session has expired or was already used. Please try again from NaaP.',
      true
    );
  }

  if (session.providerSlug !== providerSlug) {
    return htmlResponse('Authentication Failed', 'Provider/session mismatch detected.', true);
  }

  if (Date.now() >= new Date(session.expiresAt).getTime()) {
    await prisma.billingProviderOAuthSession
      .updateMany({
        where: {
          loginSessionId: session.loginSessionId,
          status: 'pending',
        },
        data: { status: 'expired' },
      })
      .catch(() => null);

    return htmlResponse(
      'Session Expired',
      'The login session has expired or was already used. Please try again from NaaP.',
      true
    );
  }

  const providerConfig = await prisma.billingProvider.findUnique({ where: { slug: providerSlug } });

  try {
    if (providerConfig?.authType === 'oidc' && code) {
      // OIDC flow: exchange code for tokens and validate id_token
      const appUrl = resolveAppUrl(request, providerConfig.callbackOrigin);
      const redirectUri = `${appUrl}/api/v1/auth/providers/${encodeURIComponent(providerSlug)}/callback`;

      const { accessToken, idTokenClaims } = await handleOidcCallback(
        providerConfig,
        code,
        redirectUri,
        {
          loginSessionId: session.loginSessionId,
          nonce: session.nonce,
          codeVerifier: session.codeVerifier,
        }
      );

      await prisma.billingProviderOAuthSession.update({
        where: { loginSessionId: session.loginSessionId },
        data: {
          status: 'complete',
          accessToken: encryptToken(accessToken),
          idTokenSub: idTokenClaims.sub,
          idTokenClaims: idTokenClaims as unknown as Record<string, unknown>,
          providerUserId: idTokenClaims.sub,
        },
      });

      console.log(
        `[billing-auth:${providerSlug}] OIDC callback complete for session ${session.loginSessionId.slice(0, 8)}..., sub=${idTokenClaims.sub}`
      );

      return htmlResponse('Authentication Complete', 'You can close this tab and return to NaaP.');
    } else if (token) {
      // Legacy OAuth flow: exchange token for API key
      const apiKey = await exchangeTokenForApiKey(providerSlug, token);

      await prisma.billingProviderOAuthSession.update({
        where: { loginSessionId: session.loginSessionId },
        data: {
          status: 'complete',
          accessToken: encryptToken(apiKey),
        },
      });

      console.log(
        `[billing-auth:${providerSlug}] Legacy OAuth callback complete for session ${session.loginSessionId.slice(0, 8)}...`
      );

      return htmlResponse('Authentication Complete', 'You can close this tab and return to NaaP.');
    } else {
      return htmlResponse(
        'Authentication Failed',
        'Missing code or token parameter from provider.',
        true
      );
    }
  } catch (err) {
    console.error(`[billing-auth:${providerSlug}] Callback error:`, err);
    return htmlResponse(
      'Authentication Failed',
      err instanceof Error ? err.message : 'Failed to authenticate with billing provider.',
      true
    );
  }
}
