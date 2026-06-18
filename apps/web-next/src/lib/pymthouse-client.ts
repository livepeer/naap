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
import type { PmtHouseClient } from '@pymthouse/builder-sdk';

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

/** Vitest / isolated tests: clear module-level singleton. */
export function resetPmtHouseServerClientForTests(): void {
  cached = null;
}

/**
 * Exchange a short-lived user JWT for an opaque `pmth_…` signer session.
 *
 * `@pymthouse/builder-sdk@0.4.3` `PmtHouseClient.mintSignerSessionForExternalUser` sets
 * `resource` to the OIDC issuer URL. Current PymtHouse routes that to signer-JWT
 * exchange (no `issued_token_type`, returns another JWT). Omitting `resource` selects
 * gateway opaque-session exchange instead.
 */
async function exchangeUserJwtForOpaqueSignerSession(
  userJwt: string,
  scope: string = SIGN_JOB_SCOPE,
): Promise<SignerSessionToken> {
  const env = readPymthouseEnv();
  if (!env) {
    throw new PmtHouseError(PYMTHOUSE_NOT_CONFIGURED_MESSAGE, {
      status: 400,
      code: 'pymthouse_required',
    });
  }

  const allowInsecureHttp =
    process.env.PYMTHOUSE_ALLOW_INSECURE_HTTP === '1' || env.issuerUrl.startsWith('http:');

  const as = await loadAuthorizationServer(env.issuerUrl, fetch, { allowInsecureHttp });
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
      Authorization: `Basic ${Buffer.from(`${env.m2mClientId}:${env.m2mClientSecret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: params.toString(),
    cache: 'no-store',
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
    expires_in: expiresIn ?? 0,
    scope: scopeOut,
    issued_token_type: issuedTokenType ?? REQUESTED_ACCESS_TOKEN_TYPE,
  });
}

/** Mint an opaque `pmth_…` signer session for a NaaP user (workaround for SDK 0.4.3 routing). */
export async function mintSignerSessionForExternalUser(input: {
  externalUserId: string;
  email?: string;
  scope?: string;
}): Promise<SignerSessionToken> {
  const client = getPmtHouseServerClient();
  const scope = input.scope?.trim() || SIGN_JOB_SCOPE;

  await client.upsertAppUser({
    externalUserId: input.externalUserId,
    email: input.email,
    status: 'active',
  });

  const userToken = await client.mintUserAccessToken({
    externalUserId: input.externalUserId,
    scope,
  });

  return exchangeUserJwtForOpaqueSignerSession(userToken.access_token, scope);
}
