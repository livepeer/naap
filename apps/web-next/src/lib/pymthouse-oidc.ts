/**
 * PymtHouse Builder API helpers for NaaP → PymtHouse server-to-server.
 *
 * NaaP authenticates to PymtHouse as a confidential OAuth client (Basic auth
 * with `clientId:clientSecret`) and mints **short-lived user-scoped JWTs**
 * (`scope: "sign:job"`, TTL ~15 min) bound to the logged-in NaaP user via
 * `externalUserId = naapUserId`.
 *
 * These JWTs are intentionally ephemeral and must not be stored long-term.
 * Consumers should call `issuePymthouseUserAccessToken` each time they need
 * a fresh token for a user (e.g. from the mint-on-demand endpoint).
 *
 * See PymtHouse `docs/builder-api.md` + `src/lib/auth.ts::authenticateAppClient`
 * (which accepts only Basic auth).
 */

const TRAILING_SLASH = /\/+$/;

/** Only scope NaaP ever hands to an end user. */
export const PYMTHOUSE_USER_TOKEN_SCOPE = 'sign:job';

/** RFC 6749 `token_type` value returned alongside PymtHouse JWTs. */
export const PYMTHOUSE_TOKEN_TYPE = 'Bearer';

export interface PymthouseUserAccessToken {
  accessToken: string;
  tokenType: typeof PYMTHOUSE_TOKEN_TYPE;
  expiresIn: number;
  scope: typeof PYMTHOUSE_USER_TOKEN_SCOPE;
}

export function getPymthouseIssuerBase(): string | null {
  const raw = process.env.PYMTHOUSE_ISSUER_URL?.trim();
  if (!raw) return null;
  return raw.replace(TRAILING_SLASH, '');
}

/**
 * OAuth `client_id` used for Builder API paths `/api/v1/apps/{clientId}/...`
 * and for confidential-client Basic auth. Must be the app id (e.g. `app_...`).
 */
/** Public `app_…` client_id (SDK / device flow). */
export function getPymthouseOidcClientId(): string | null {
  const raw = process.env.PMTHOUSE_CLIENT_ID?.trim();
  return raw || null;
}

/** Confidential M2M sibling (`m2m_…`) for Builder API Basic auth and RFC 8693 device approval at `{issuer}/token`. */
export function getPymthouseM2mClientId(): string | null {
  return process.env.PMTHOUSE_M2M_CLIENT_ID?.trim() || null;
}

export function getPymthouseM2mClientSecret(): string | null {
  return (
    process.env.PMTHOUSE_M2M_CLIENT_SECRET?.trim() ||
    process.env.PMTHOUSE_CLIENT_SECRET?.trim() ||
    process.env.NAAP_WEB_CLIENT_SECRET?.trim() ||
    null
  );
}

/** @deprecated Prefer getPymthouseM2mClientSecret for confidential calls. */
export function getPymthouseOidcClientSecret(): string | null {
  return getPymthouseM2mClientSecret();
}

/** PymtHouse API base (strip /api/v1/oidc suffix if present; fall back to PMTHOUSE_BASE_URL). */
export function getPymthouseApiBase(): string | null {
  const siteBase = process.env.PMTHOUSE_BASE_URL?.trim().replace(TRAILING_SLASH, '');
  if (siteBase) return siteBase;
  const issuer = getPymthouseIssuerBase();
  if (!issuer) return null;
  return issuer.replace(/\/api\/v1\/oidc$/i, '');
}

/** True iff all PymtHouse confidential-client env is configured. */
export function isPymthouseConfigured(): boolean {
  return Boolean(
    getPymthouseApiBase() &&
      getPymthouseOidcClientId() &&
      getPymthouseM2mClientId() &&
      getPymthouseM2mClientSecret(),
  );
}

function buildBasicAuthHeader(clientId: string, clientSecret: string): string {
  const creds = Buffer.from(`${clientId}:${clientSecret}`, 'utf-8').toString('base64');
  return `Basic ${creds}`;
}

async function upsertPymthouseBuilderUser(
  basicAuth: string,
  clientId: string,
  externalUserId: string,
  opts?: { email?: string },
): Promise<void> {
  const base = getPymthouseApiBase();
  if (!base) {
    throw new Error('PYMTHOUSE_ISSUER_URL or PMTHOUSE_BASE_URL must be set');
  }

  const enc = encodeURIComponent(clientId);
  const url = `${base}/api/v1/apps/${enc}/users`;
  const body: Record<string, string> = {
    externalUserId,
    status: 'active',
  };
  if (opts?.email) body.email = opts.email;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15_000);
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: basicAuth,
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
      `PymtHouse Builder POST /apps/{clientId}/users failed (${response.status}). ` +
        `Ensure PMTHOUSE_CLIENT_ID/PMTHOUSE_CLIENT_SECRET are correct and the client has users:write. ${text}`,
    );
  }
}

async function issuePymthouseUserSignJobToken(
  basicAuth: string,
  clientId: string,
  externalUserId: string,
): Promise<PymthouseUserAccessToken> {
  const base = getPymthouseApiBase();
  if (!base) {
    throw new Error('PYMTHOUSE_ISSUER_URL or PMTHOUSE_BASE_URL must be set');
  }

  const enc = encodeURIComponent(clientId);
  const extEnc = encodeURIComponent(externalUserId);
  const url = `${base}/api/v1/apps/${enc}/users/${extEnc}/token`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15_000);
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: basicAuth,
      },
      body: JSON.stringify({ scope: PYMTHOUSE_USER_TOKEN_SCOPE }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `PymtHouse Builder POST .../users/{externalUserId}/token failed (${response.status}). ` +
        `Ensure the confidential client has users:token and sign:job in its allowed scopes. ${text}`,
    );
  }

  const json = (await response.json()) as Record<string, unknown>;
  const accessToken = json.access_token;
  if (typeof accessToken !== 'string' || !accessToken) {
    throw new Error('PymtHouse user token response missing access_token');
  }

  const returnedScope = typeof json.scope === 'string' ? json.scope.trim() : '';
  if (returnedScope !== PYMTHOUSE_USER_TOKEN_SCOPE) {
    throw new Error(
      `PymtHouse user token has unexpected scope "${returnedScope}"; expected "${PYMTHOUSE_USER_TOKEN_SCOPE}"`,
    );
  }

  const expiresIn = typeof json.expires_in === 'number' && json.expires_in > 0
    ? Math.floor(json.expires_in)
    : 15 * 60;

  return {
    accessToken,
    tokenType: PYMTHOUSE_TOKEN_TYPE,
    expiresIn,
    scope: PYMTHOUSE_USER_TOKEN_SCOPE,
  };
}

/**
 * Upsert the NaaP user on PymtHouse and return a fresh short-lived `sign:job`
 * JWT for that user. Safe to call on every request — the upsert is idempotent
 * and the issued JWT is scoped to a single end user.
 *
 * `naapUserId` is used as `externalUserId`, enforcing a 1:1 mapping between
 * each logged-in NaaP user and a single PymtHouse app user.
 */
export async function issuePymthouseUserAccessToken(
  naapUserId: string,
  opts?: { email?: string },
): Promise<PymthouseUserAccessToken> {
  const publicClientId = getPymthouseOidcClientId();
  const m2mId = getPymthouseM2mClientId();
  const m2mSecret = getPymthouseM2mClientSecret();
  if (!publicClientId) {
    throw new Error('PMTHOUSE_CLIENT_ID must be set (public app id, e.g. app_...)');
  }
  if (!m2mId || !m2mSecret) {
    throw new Error(
      'PMTHOUSE_M2M_CLIENT_ID and PMTHOUSE_M2M_CLIENT_SECRET must be set (confidential backend client)',
    );
  }

  const basicAuth = buildBasicAuthHeader(m2mId, m2mSecret);
  await upsertPymthouseBuilderUser(basicAuth, publicClientId, naapUserId, opts);
  return issuePymthouseUserSignJobToken(basicAuth, publicClientId, naapUserId);
}

export type PymthouseDeviceApproveResult =
  | { ok: true }
  | { ok: false; status: number; message: string };

/**
 * Approve a pending device code: mint a user JWT via Builder, then RFC 8693 token exchange at `{issuer}/token`.
 */
export async function approvePymthouseDeviceCode(params: {
  publicClientId: string;
  userCode: string;
  externalUserId: string;
  email?: string | null;
}): Promise<PymthouseDeviceApproveResult> {
  const issuerBase = getPymthouseIssuerBase();
  const m2mId = getPymthouseM2mClientId();
  const m2mSecret = getPymthouseM2mClientSecret();
  if (!issuerBase || !m2mId || !m2mSecret) {
    return {
      ok: false,
      status: 500,
      message: 'PymtHouse M2M client is not configured (PYMTHOUSE_ISSUER_URL, PMTHOUSE_M2M_CLIENT_ID / PMTHOUSE_M2M_CLIENT_SECRET)',
    };
  }

  if (params.publicClientId !== getPymthouseOidcClientId()) {
    return {
      ok: false,
      status: 400,
      message: 'publicClientId does not match PMTHOUSE_CLIENT_ID',
    };
  }

  let subjectToken: string;
  try {
    const minted = await issuePymthouseUserAccessToken(params.externalUserId, {
      email: params.email ?? undefined,
    });
    subjectToken = minted.accessToken;
  } catch (e) {
    return {
      ok: false,
      status: 502,
      message: e instanceof Error ? e.message : 'Failed to mint subject token for device approval',
    };
  }

  const tokenUrl = `${issuerBase}/token`;
  const basicAuth = buildBasicAuthHeader(m2mId, m2mSecret);
  const body = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
    subject_token: subjectToken,
    subject_token_type: 'urn:ietf:params:oauth:token-type:access_token',
    resource: `urn:pmth:device_code:${params.userCode.trim()}`,
  });

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 20_000);
  let response: Response;
  try {
    response = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: basicAuth,
      },
      body: body.toString(),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }

  if (response.ok) {
    return { ok: true };
  }

  const raw = await response.text();
  let message = `HTTP ${response.status}`;
  if (raw) {
    try {
      const j = JSON.parse(raw) as { error_description?: string; error?: string };
      if (typeof j.error_description === 'string' && j.error_description) {
        message = j.error_description;
      } else if (typeof j.error === 'string' && j.error) {
        message = j.error;
      } else {
        message = raw.slice(0, 500);
      }
    } catch {
      message = raw.slice(0, 500);
    }
  }

  return { ok: false, status: response.status, message };
}
