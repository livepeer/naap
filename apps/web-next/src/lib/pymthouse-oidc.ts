/**
 * PymtHouse OIDC helpers for NaaP → PymtHouse server-to-server (client credentials).
 *
 * NaaP authenticates as a confidential machine client — no browser redirect, no
 * authorization code, no redirect_uri.  PymtHouse issues the gateway token on
 * behalf of the NaaP user confidentially via POST /api/v1/naap/link-user.
 */

const TRAILING_SLASH = /\/+$/;

export function getPymthouseIssuerBase(): string | null {
  const raw = process.env.PYMTHOUSE_ISSUER_URL?.trim();
  if (!raw) return null;
  return raw.replace(TRAILING_SLASH, '');
}

/**
 * OAuth `client_id` for client_credentials — default **`naap-service`**.
 * Must be a confidential OIDC client registered on PymtHouse with `gateway` in
 * its allowed scopes.
 */
export function getPymthouseOidcClientId(): string {
  return process.env.PMTHOUSE_CLIENT_ID?.trim() || 'naap-service';
}

export function getPymthouseOidcClientSecret(): string | null {
  return (
    process.env.PMTHOUSE_CLIENT_SECRET?.trim() ||
    process.env.NAAP_WEB_CLIENT_SECRET?.trim() ||
    null
  );
}

/** PymtHouse API base (strip /api/v1/oidc suffix if present; fall back to PMTHOUSE_BASE_URL). */
export function getPymthouseApiBase(): string | null {
  const siteBase = process.env.PMTHOUSE_BASE_URL?.trim().replace(TRAILING_SLASH, '');
  if (siteBase) return siteBase;
  const issuer = getPymthouseIssuerBase();
  if (!issuer) return null;
  return issuer.replace(/\/api\/v1\/oidc$/i, '');
}

/**
 * Obtain a short-lived service JWT from PymtHouse via `client_credentials` grant.
 * Used server-side only — never sent to the browser.
 */
export async function getPymthouseServiceToken(): Promise<string> {
  const issuer = getPymthouseIssuerBase();
  const clientId = getPymthouseOidcClientId();
  const clientSecret = getPymthouseOidcClientSecret();
  if (!issuer || !clientSecret) {
    throw new Error(
      'PYMTHOUSE_ISSUER_URL and PMTHOUSE_CLIENT_SECRET (or NAAP_WEB_CLIENT_SECRET) must be set',
    );
  }

  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret,
    scope: 'gateway sign:job discover:orchestrators',
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
    throw new Error(
      `PymtHouse client_credentials failed (${response.status}). ` +
        `Ensure ${clientId} is a confidential OIDC client with gateway scope on PymtHouse. ${text}`,
    );
  }

  const json = (await response.json()) as Record<string, unknown>;
  const accessToken = json.access_token;
  if (typeof accessToken !== 'string' || !accessToken) {
    throw new Error('PymtHouse client_credentials response missing access_token');
  }
  return accessToken;
}

/**
 * Ask PymtHouse to link a NaaP user and issue a long-lived gateway session token.
 * PymtHouse records `naapUserId` as `endUserId` for usage attribution.
 *
 * Returns the opaque `pmth_*` gateway session token to store as the API key.
 */
export async function linkPymthouseUser(
  serviceToken: string,
  naapUserId: string,
  opts?: { email?: string },
): Promise<string> {
  const base = getPymthouseApiBase();
  if (!base) {
    throw new Error('PYMTHOUSE_ISSUER_URL or PMTHOUSE_BASE_URL must be set');
  }

  const url = `${base}/api/v1/naap/link-user`;
  const body: Record<string, string> = { naapUserId };
  if (opts?.email) body.email = opts.email;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15_000);
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${serviceToken}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `PymtHouse link-user failed (${response.status}). ` +
        `Ensure naap-service has gateway scope and PYMTHOUSE_ISSUER_URL points to the OIDC issuer. ${text}`,
    );
  }

  const json = (await response.json()) as Record<string, unknown>;
  const apiKey = json.api_key ?? json.access_token;
  if (typeof apiKey !== 'string' || !apiKey) {
    throw new Error('PymtHouse link-user response missing api_key');
  }
  return apiKey;
}
