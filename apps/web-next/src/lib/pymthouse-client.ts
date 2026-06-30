/**
 * Server-only entry for `@pymthouse/builder-sdk` (M2M secrets must not ship to the browser).
 * Route handlers and server libs import from here, not from `@pymthouse/builder-sdk/env` directly.
 */

import 'server-only';

import {
  loadAuthorizationServer,
  PmtHouseError,
  PYMTHOUSE_NOT_CONFIGURED_MESSAGE,
  readPymthouseEnv,
  SIGN_JOB_SCOPE,
  parseSignerSessionExchange,
  type SignerSessionToken,
} from '@pymthouse/builder-sdk';
import { createPmtHouseClientFromEnv } from '@pymthouse/builder-sdk/env';
import { PmtHouseClient } from '@pymthouse/builder-sdk';

const TOKEN_EXCHANGE_GRANT = 'urn:ietf:params:oauth:grant-type:token-exchange';
const SUBJECT_ACCESS_TOKEN_TYPE = 'urn:ietf:params:oauth:token-type:access_token';
const REQUESTED_ACCESS_TOKEN_TYPE = 'urn:ietf:params:oauth:token-type:access_token';

let cached: PmtHouseClient | null = null;

export function getPmtHouseServerClient(): PmtHouseClient {
  if (!cached) {
    cached = createPmtHouseClientFromEnv();
  }
  return cached;
}

/**
 * Non-secret connection params for a pymthouse instance, plus the resolved M2M
 * client secret. Mirrors the env shape `createPmtHouseClientFromEnv` builds, but
 * sourced explicitly (e.g. from a `ProviderInstance.config` + `SecretVault`)
 * rather than from global `PYMTHOUSE_*` env. The secret is passed in resolved;
 * this module never reads or logs it.
 */
export interface PmtHouseClientConfig {
  issuerUrl: string;
  publicClientId: string;
  m2mClientId: string;
  m2mClientSecret: string;
  allowInsecureHttp?: boolean;
}

/**
 * Build a `PmtHouseClient` from an explicit per-instance config (NOT global
 * env), so multiple pymthouse apps can coexist in one process. Unlike
 * `getPmtHouseServerClient()` this is NOT a process singleton — the caller owns
 * caching (e.g. the registry caches per `ProviderInstance.id`). Logging matches
 * the env client: structured `[pymthouse]` lines that never include the secret.
 */
export function createPmtHouseClient(config: PmtHouseClientConfig): PmtHouseClient {
  return new PmtHouseClient({
    issuerUrl: config.issuerUrl,
    publicClientId: config.publicClientId,
    m2mClientId: config.m2mClientId,
    m2mClientSecret: config.m2mClientSecret,
    allowInsecureHttp: config.allowInsecureHttp ?? config.issuerUrl.startsWith('http:'),
    logger: {
      debug: (message: string, details?: unknown) => {
        if (process.env.NODE_ENV !== 'production') {
          console.debug(`[pymthouse] ${message}`, details ?? {});
        }
      },
      warn: (message: string, details?: unknown) => {
        console.warn(`[pymthouse] ${message}`, details ?? {});
      },
    },
  });
}

/** Vitest / isolated tests: clear module-level singleton. */
export function resetPmtHouseServerClientForTests(): void {
  cached = null;
}

/**
 * Non-secret connection params + M2M secret needed to perform the opaque
 * signer-session token-exchange. Mirrors {@link PmtHouseClientConfig} but only
 * the subset the exchange step needs, so a per-`ProviderInstance` adapter can
 * exchange against ITS app's token endpoint/creds (not the global env).
 */
export interface PymthouseSignerExchangeConfig {
  issuerUrl: string;
  m2mClientId: string;
  m2mClientSecret: string;
  allowInsecureHttp?: boolean;
}

/** Resolve the global `PYMTHOUSE_*` env into a signer-exchange config (or throw). */
export function globalSignerExchangeConfig(): PymthouseSignerExchangeConfig {
  const env = readPymthouseEnv();
  if (!env) {
    throw new PmtHouseError(PYMTHOUSE_NOT_CONFIGURED_MESSAGE, {
      status: 400,
      code: 'pymthouse_required',
    });
  }
  return {
    issuerUrl: env.issuerUrl,
    m2mClientId: env.m2mClientId,
    m2mClientSecret: env.m2mClientSecret,
  };
}

/**
 * Exchange a short-lived user JWT for an opaque `pmth_…` signer session, using an
 * EXPLICIT connection config (per-instance or global).
 *
 * `@pymthouse/builder-sdk@0.4.3` `PmtHouseClient.mintSignerSessionForExternalUser` sets
 * `resource` to the OIDC issuer URL. Current PymtHouse routes that to signer-JWT
 * exchange (no `issued_token_type`, returns another JWT). Omitting `resource` selects
 * gateway opaque-session exchange instead.
 */
async function exchangeUserJwtForOpaqueSignerSessionWith(
  userJwt: string,
  cfg: PymthouseSignerExchangeConfig,
  scope: string = SIGN_JOB_SCOPE,
): Promise<SignerSessionToken> {
  const allowInsecureHttp =
    cfg.allowInsecureHttp ??
    (process.env.PYMTHOUSE_ALLOW_INSECURE_HTTP === '1' || cfg.issuerUrl.startsWith('http:'));

  const as = await loadAuthorizationServer(cfg.issuerUrl, fetch, { allowInsecureHttp });
  const tokenEndpoint = as.token_endpoint;
  if (!tokenEndpoint) {
    throw new PmtHouseError('OIDC discovery document is missing token_endpoint', {
      status: 502,
      code: 'oidc_discovery_invalid',
    });
  }

  const params = new URLSearchParams();
  params.set('grant_type', TOKEN_EXCHANGE_GRANT);
  params.set('subject_token', userJwt);
  params.set('subject_token_type', SUBJECT_ACCESS_TOKEN_TYPE);
  params.set('requested_token_type', REQUESTED_ACCESS_TOKEN_TYPE);
  if (scope.trim()) {
    params.set('scope', scope.trim());
  }

  const response = await fetch(tokenEndpoint, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${cfg.m2mClientId}:${cfg.m2mClientSecret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: params.toString(),
    cache: 'no-store',
    // Fail fast instead of hanging if the PymtHouse token endpoint is unresponsive.
    signal: AbortSignal.timeout(15_000),
  });

  let body: Record<string, unknown>;
  try {
    body = (await response.json()) as Record<string, unknown>;
  } catch {
    throw new PmtHouseError('Token exchange returned invalid JSON', {
      status: 502,
      code: 'invalid_token_response',
    });
  }

  if (!response.ok) {
    const description =
      typeof body.error_description === 'string'
        ? body.error_description
        : typeof body.error === 'string'
          ? body.error
          : `Token exchange failed (${response.status})`;
    throw new PmtHouseError(description, {
      status: response.status,
      code: typeof body.error === 'string' ? body.error : 'token_exchange_failed',
      details: body,
    });
  }

  const accessToken =
    typeof body.access_token === 'string' ? body.access_token.trim() : '';
  const expiresIn =
    typeof body.expires_in === 'number' && Number.isFinite(body.expires_in)
      ? body.expires_in
      : undefined;
  const scopeOut =
    typeof body.scope === 'string' && body.scope.trim() ? body.scope.trim() : scope;
  const issuedTokenType =
    typeof body.issued_token_type === 'string' ? body.issued_token_type : undefined;

  return parseSignerSessionExchange({
    access_token: accessToken,
    token_type: 'Bearer',
    // Fall back to a conservative 5-minute TTL when the provider omits
    // `expires_in`; a 0 here would mark the session as immediately expired and
    // disable the SDK's proactive (80%-of-TTL) refresh / reuse.
    expires_in: expiresIn ?? 300,
    scope: scopeOut,
    issued_token_type: issuedTokenType ?? REQUESTED_ACCESS_TOKEN_TYPE,
  });
}

/**
 * Mint an opaque `pmth_…` signer session for a NaaP user against an EXPLICIT
 * client + exchange config (workaround for SDK 0.4.3 `resource` routing).
 *
 * This is the multi-app-safe core: the per-`ProviderInstance` adapter passes ITS
 * client + ITS app's exchange config so the upsert/user-token/exchange all bind
 * to the same app. The global path ({@link mintSignerSessionForExternalUser})
 * delegates here with the env client + env config.
 */
export async function mintOpaqueSignerSessionForExternalUser(input: {
  client: PmtHouseClient;
  exchange: PymthouseSignerExchangeConfig;
  externalUserId: string;
  email?: string;
  scope?: string;
}): Promise<SignerSessionToken> {
  const scope = input.scope?.trim() || SIGN_JOB_SCOPE;

  await input.client.upsertAppUser({
    externalUserId: input.externalUserId,
    email: input.email,
    status: 'active',
  });

  const userToken = await input.client.mintUserAccessToken({
    externalUserId: input.externalUserId,
    scope,
  });

  return exchangeUserJwtForOpaqueSignerSessionWith(userToken.access_token, input.exchange, scope);
}

/** Mint an opaque `pmth_…` signer session for a NaaP user (global `PYMTHOUSE_*` env). */
export async function mintSignerSessionForExternalUser(input: {
  externalUserId: string;
  email?: string;
  scope?: string;
}): Promise<SignerSessionToken> {
  return mintOpaqueSignerSessionForExternalUser({
    client: getPmtHouseServerClient(),
    exchange: globalSignerExchangeConfig(),
    externalUserId: input.externalUserId,
    ...(input.email != null ? { email: input.email } : {}),
    ...(input.scope != null ? { scope: input.scope } : {}),
  });
}

/** Result of minting the user-token JWT forwarded to the remote signer DMZ. */
export interface UserSignerJwt {
  /** The user-scoped JWT (`eyJ…`) to forward as `Authorization: Bearer`. */
  jwt: string;
  /** Seconds until the JWT expires (>= 1), derived from the mint response. */
  expiresIn: number;
  /** Scope the token carries (always `sign:job` for the signed-job path). */
  scope: string;
}

/**
 * Mint the Builder USER-TOKEN JWT for a NaaP user and return it for forwarding
 * to the remote signer DMZ as `Authorization: Bearer <jwt>`.
 *
 * This is the downstream token the pymthouse "User-scoped JWTs" doc prescribes
 * under "Passing the token to downstream services" (mint at
 * `POST /api/v1/apps/{clientId}/users/{externalUserId}/token`, then pass the JWT
 * to any PymtHouse service that validates it), and the same token the
 * signer-routing `directDmz` pattern calls for ("Mint a user JWT via Builder API
 * OIDC, sign against the remote signer DMZ directly").
 *
 * The minted JWT carries exactly the claims the DMZ OIDC identity webhook
 * validates: `aud` = the issuer URL (matches the webhook's default
 * `JWT_AUDIENCE`), `iss` = issuer, `client_id`/`azp` = the public app, and
 * `scope` includes `sign:job` (usage is attributed via the `sub` app-user id).
 * It mints successfully against the live issuer — unlike the token-exchange
 * "Option A" clearinghouse mint (`grant_type=client_credentials`,
 * `scope=sign:mint_user_token`), which currently returns
 * `500 "Internal error during token mint"` upstream.
 *
 * The user is upserted first (idempotent) so the mint never 404s on a not-yet
 * provisioned `externalUserId`.
 */
export async function mintUserSignerJwtForExternalUser(input: {
  client: PmtHouseClient;
  externalUserId: string;
  email?: string;
  scope?: string;
}): Promise<UserSignerJwt> {
  const scope = input.scope?.trim() || SIGN_JOB_SCOPE;

  await input.client.upsertAppUser({
    externalUserId: input.externalUserId,
    ...(input.email != null ? { email: input.email } : {}),
    status: 'active',
  });

  const token = await input.client.mintUserAccessToken({
    externalUserId: input.externalUserId,
    scope,
  });

  const expiresIn =
    Number.isFinite(token.expires_in) && token.expires_in > 0
      ? Math.floor(token.expires_in)
      : 300;

  return {
    jwt: token.access_token,
    // Clamp to >= 1s so a near-expiry mint never serializes a non-positive TTL.
    expiresIn: Math.max(1, expiresIn),
    scope: token.scope?.trim() || scope,
  };
}

/**
 * Non-secret connection params + a `pmth_…` API key needed to perform the new
 * single-call signer-session exchange documented at
 * `POST /api/v1/apps/{clientId}/auth/api-key/signer-session`.
 *
 * `billingUrl` is the PymtHouse ORIGIN (e.g. `https://pymthouse.com`), NOT the
 * `/api/v1/oidc` issuer URL — the endpoint lives under `/api/v1/apps/...`.
 */
export interface PymthouseApiKeyExchangeConfig {
  billingUrl: string;
  clientId: string;
  apiKey: string;
  scope?: string;
}

/** Result of the api-key → signer-session exchange (endpoint form inputs). */
export interface ApiKeySignerSession {
  /** Signer-session token to forward as `Authorization: Bearer …`. */
  accessToken: string;
  /** Remote signer DMZ base URL the provider returned (or null when omitted). */
  signerUrl: string | null;
  /** Seconds until the session expires (>= 1), defaulted when omitted. */
  expiresIn: number;
  /** Scope the session carries (defaults to the requested scope). */
  scope: string;
  /** Always `Bearer` for the signer DMZ. */
  tokenType: string;
}

/**
 * Read the signer-session token out of the exchange response envelope.
 *
 * Mirrors the canonical example client
 * (`livepeer-gateway-client@30df477` `auth_exchange._signer_access_token`):
 * accept either the nested `token.{accessToken,access_token}` envelope OR a
 * flat top-level `{accessToken,access_token}`.
 */
function readSignerAccessToken(body: Record<string, unknown>): string {
  const token = body.token;
  if (token && typeof token === 'object' && !Array.isArray(token)) {
    const rec = token as Record<string, unknown>;
    for (const key of ['accessToken', 'access_token'] as const) {
      const value = rec[key];
      if (typeof value === 'string' && value.trim()) return value.trim();
    }
  }
  for (const key of ['accessToken', 'access_token'] as const) {
    const value = body[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  throw new PmtHouseError('API key signer-session response missing signer access token', {
    status: 502,
    code: 'invalid_token_response',
  });
}

/** Read the optional signer DMZ URL (`signerUrl` | `signer_url`) from the envelope. */
function readSignerUrl(body: Record<string, unknown>): string | null {
  for (const key of ['signerUrl', 'signer_url'] as const) {
    const value = body[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

/**
 * Exchange a `pmth_…` API key for a signer session via the NEW PymtHouse
 * endpoint `POST /api/v1/apps/{clientId}/auth/api-key/signer-session`.
 *
 * This is the contract John relocated the token-exchange to (the example client
 * `livepeer-gateway-client@30df477` `exchange_api_key_for_signer`): a SINGLE
 * authenticated POST that returns both the signer-session token AND the remote
 * signer DMZ url — collapsing NaaP's older multi-step "mint user JWT → manually
 * token-exchange" shim into one call. The API key is sent as the bearer; the
 * `clientId` is URL-encoded into the path; the body carries the requested scope.
 */
export async function exchangeApiKeyForSignerSession(
  cfg: PymthouseApiKeyExchangeConfig,
): Promise<ApiKeySignerSession> {
  const apiKey = cfg.apiKey.trim();
  if (!apiKey) {
    throw new PmtHouseError('API key signer-session exchange requires a non-empty API key', {
      status: 400,
      code: 'pymthouse_required',
    });
  }
  const clientId = cfg.clientId.trim();
  if (!clientId) {
    throw new PmtHouseError('API key signer-session exchange requires a non-empty clientId', {
      status: 400,
      code: 'pymthouse_required',
    });
  }
  const scope = cfg.scope?.trim() || SIGN_JOB_SCOPE;
  const url =
    `${cfg.billingUrl.replace(/\/+$/, '')}/api/v1/apps/` +
    `${encodeURIComponent(clientId)}/auth/api-key/signer-session`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(scope ? { scope } : {}),
    cache: 'no-store',
    // Fail fast instead of hanging if the PymtHouse endpoint is unresponsive.
    signal: AbortSignal.timeout(15_000),
  });

  let body: Record<string, unknown>;
  try {
    body = (await response.json()) as Record<string, unknown>;
  } catch {
    throw new PmtHouseError('API key signer-session exchange returned invalid JSON', {
      status: 502,
      code: 'invalid_token_response',
    });
  }

  if (!response.ok) {
    const description =
      typeof body.error_description === 'string'
        ? body.error_description
        : typeof body.error === 'string'
          ? body.error
          : `API key signer-session exchange failed (${response.status})`;
    throw new PmtHouseError(description, {
      status: response.status,
      code: typeof body.error === 'string' ? body.error : 'signer_session_exchange_failed',
      details: body,
    });
  }

  const accessToken = readSignerAccessToken(body);
  const expiresIn =
    typeof body.expires_in === 'number' && Number.isFinite(body.expires_in) && body.expires_in > 0
      ? Math.floor(body.expires_in)
      : 300;
  const scopeOut = typeof body.scope === 'string' && body.scope.trim() ? body.scope.trim() : scope;

  return {
    accessToken,
    signerUrl: readSignerUrl(body),
    expiresIn: Math.max(1, expiresIn),
    scope: scopeOut,
    tokenType: 'Bearer',
  };
}
