/**
 * GET /api/v1/auth/providers/:providerSlug/callback
 * Provider redirects the browser here after user authentication.
 */

import { NextRequest, NextResponse } from 'next/server';
import { billingProviderLoginSessions } from '../../_sessions';

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

  const response = await fetch(`${DAYDREAM_API_BASE}/v1/api-key`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ name: 'dd_naap_linked' }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Daydream token exchange failed: ${response.status} ${text}`);
  }

  const result = await response.json();
  return result.api_key || result.apiKey || result.key;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ providerSlug: string }> }
): Promise<NextResponse> {
  const { providerSlug } = await params;
  const searchParams = request.nextUrl.searchParams;
  const token = searchParams.get('token');
  const state = searchParams.get('state');
  const userId = searchParams.get('userId');

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

  if (!token || !state) {
    return htmlResponse(
      'Authentication Failed',
      'Missing token or state parameter from billing provider.',
      true
    );
  }

  const session = billingProviderLoginSessions.get(`state:${state}`);
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

  try {
    const apiKey = await exchangeTokenForApiKey(providerSlug, token);

    session.status = 'complete';
    session.accessToken = apiKey;
    session.userId = userId;
    billingProviderLoginSessions.set(session.loginSessionId, session);
    billingProviderLoginSessions.set(`state:${state}`, session);

    console.log(
      `[billing-auth:${providerSlug}] Callback complete for session ${session.loginSessionId.slice(0, 8)}...`
    );

    return htmlResponse('Authentication Complete', 'You can close this tab and return to NaaP.');
  } catch (err) {
    console.error(`[billing-auth:${providerSlug}] Callback error:`, err);
    return htmlResponse(
      'Authentication Failed',
      err instanceof Error ? err.message : 'Failed to authenticate with billing provider.',
      true
    );
  }
}
