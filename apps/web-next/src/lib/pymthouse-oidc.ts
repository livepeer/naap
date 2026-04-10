/**
 * PymtHouse OIDC helpers for billing-provider OAuth (naap-web client).
 */

import { createHash, randomBytes } from 'crypto';

export function generatePkcePair(): { codeVerifier: string; codeChallenge: string } {
  const codeVerifier = randomBytes(32).toString('base64url');
  const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');
  return { codeVerifier, codeChallenge };
}

export function getPymthouseIssuerBase(): string | null {
  const raw = process.env.PYMTHOUSE_ISSUER_URL?.trim();
  if (!raw) return null;
  return raw.replace(/\/+$/, '');
}

export function getPymthouseOidcClientId(): string {
  return process.env.PYMTHOUSE_OIDC_CLIENT_ID?.trim() || 'naap-web';
}

export function getPymthouseOidcClientSecret(): string | null {
  const s = process.env.NAAP_WEB_CLIENT_SECRET?.trim();
  return s || null;
}

/** Space-separated scopes — must be allowed for `naap-web` on PymtHouse. */
export function getPymthouseBillingOidcScopes(): string {
  return (
    process.env.PYMTHOUSE_OIDC_SCOPES?.trim() ||
    'openid gateway sign:job discover:orchestrators'
  );
}

export function buildPymthouseAuthorizeUrl(opts: {
  redirectUri: string;
  state: string;
  codeChallenge: string;
}): string | null {
  const issuer = getPymthouseIssuerBase();
  if (!issuer) return null;
  const clientId = getPymthouseOidcClientId();
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: opts.redirectUri,
    scope: getPymthouseBillingOidcScopes(),
    state: opts.state,
    code_challenge: opts.codeChallenge,
    code_challenge_method: 'S256',
  });
  return `${issuer}/auth?${params.toString()}`;
}

export async function exchangePymthouseAuthorizationCode(opts: {
  code: string;
  redirectUri: string;
  codeVerifier: string;
}): Promise<{ access_token: string }> {
  const issuer = getPymthouseIssuerBase();
  const clientId = getPymthouseOidcClientId();
  const clientSecret = getPymthouseOidcClientSecret();
  if (!issuer || !clientSecret) {
    throw new Error('PYMTHOUSE_ISSUER_URL and NAAP_WEB_CLIENT_SECRET must be set');
  }

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: opts.code,
    redirect_uri: opts.redirectUri,
    client_id: clientId,
    client_secret: clientSecret,
    code_verifier: opts.codeVerifier,
  });

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15_000);
  let response: Response;
  try {
    response = await fetch(`${issuer}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`PymtHouse token exchange failed: ${response.status} ${text}`);
  }

  const json = (await response.json()) as Record<string, unknown>;
  const access_token = json.access_token;
  if (typeof access_token !== 'string' || !access_token) {
    throw new Error('PymtHouse token response missing access_token');
  }
  return { access_token };
}

/**
 * Exchange OIDC access token for a long-lived gateway API key (legacy endpoint).
 * Requires `LEGACY_NAAP_LINK_ENABLED` on PymtHouse unless a dedicated endpoint replaces it.
 */
export async function exchangePymthouseAccessTokenForApiKey(accessToken: string): Promise<string> {
  const issuer = getPymthouseIssuerBase();
  if (!issuer) {
    throw new Error('PYMTHOUSE_ISSUER_URL must be set');
  }
  const base = issuer.replace(/\/api\/v1\/oidc$/i, '');
  const url = `${base}/api/v1/naap/exchange`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15_000);
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: '{}',
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `PymtHouse API key exchange failed (${response.status}). ` +
        `Ensure LEGACY_NAAP_LINK_ENABLED is not false on PymtHouse and the access token includes gateway scope. ${text}`
    );
  }

  const json = (await response.json()) as Record<string, unknown>;
  const apiKey = json.api_key ?? json.apiKey;
  if (typeof apiKey !== 'string' || !apiKey) {
    throw new Error('PymtHouse exchange response missing api_key');
  }
  return apiKey;
}
