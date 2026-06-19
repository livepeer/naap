/**
 * Server-only entry for `@pymthouse/builder-sdk` (M2M secrets must not ship to the browser).
 * Route handlers and server libs import from here, not from `@pymthouse/builder-sdk/env` directly.
 */

import 'server-only';

import { createPmtHouseClientFromEnv } from '@pymthouse/builder-sdk/env';
import { getPymthouseIssuerUrlFromEnv } from '@pymthouse/builder-sdk/config';
import type { PmtHouseClient } from '@pymthouse/builder-sdk';

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

const TOKEN_EXCHANGE_GRANT = 'urn:ietf:params:oauth:grant-type:token-exchange';
const ACCESS_TOKEN_TYPE = 'urn:ietf:params:oauth:token-type:access_token';

/** SDK-compatible signer-session shape (mirrors `@pymthouse/builder-sdk` `SignerSessionToken`). */
export interface PmtHouseSignerSessionResult {
  accessToken: string;
  tokenType?: string;
  expiresIn?: number;
  scope?: string;
}

/**
 * Mint a provider signer session for an external user, tolerant of the deployed
 * pymthouse signer-JWT protocol.
 *
 * The SDK's `client.mintSignerSessionForExternalUser` is opinionated that signer
 * sessions are OPAQUE and that the RFC 8693 token-exchange response carries
 * `issued_token_type`. The currently-deployed pymthouse OIDC server instead
 * returns a signer **JWT** and omits `issued_token_type`, so the SDK's strict
 * `parseSignerSessionExchange` rejects it ("expected opaque signer session
 * token" / "unexpected issued_token_type"). We reuse the SDK for the steps it
 * handles correctly (app-user upsert + user access-token mint) and perform the
 * final token exchange directly so we can accept the signer JWT. The token is
 * opaque to NaaP applications either way.
 */
export async function mintSignerSessionForExternalUserCompat(input: {
  externalUserId: string;
  email?: string;
  scope?: string;
}): Promise<PmtHouseSignerSessionResult> {
  const client = getPmtHouseServerClient();
  const scope = input.scope ?? 'sign:job';

  await client.upsertAppUser({
    externalUserId: input.externalUserId,
    ...(input.email != null ? { email: input.email } : {}),
    status: 'active',
  });

  const userToken = await client.mintUserAccessToken({
    externalUserId: input.externalUserId,
    scope,
  });

  const issuer = getPymthouseIssuerUrlFromEnv();
  if (!issuer) {
    throw new Error('PYMTHOUSE_ISSUER_URL is not configured');
  }
  const m2mClientId = process.env.PYMTHOUSE_M2M_CLIENT_ID?.trim();
  const m2mClientSecret = process.env.PYMTHOUSE_M2M_CLIENT_SECRET?.trim();
  if (!m2mClientId || !m2mClientSecret) {
    throw new Error('PYMTHOUSE_M2M_CLIENT_ID / PYMTHOUSE_M2M_CLIENT_SECRET are not configured');
  }

  const normalizedIssuer = issuer.replace(/\/+$/, '');
  const tokenEndpoint = `${normalizedIssuer}/token`;
  const basicAuth = Buffer.from(`${m2mClientId}:${m2mClientSecret}`).toString('base64');

  const body = new URLSearchParams();
  body.set('grant_type', TOKEN_EXCHANGE_GRANT);
  body.set('subject_token', userToken.access_token);
  body.set('subject_token_type', ACCESS_TOKEN_TYPE);
  body.set('requested_token_type', ACCESS_TOKEN_TYPE);
  body.set('resource', normalizedIssuer);

  const response = await fetch(tokenEndpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      authorization: `Basic ${basicAuth}`,
      accept: 'application/json',
    },
    body,
    cache: 'no-store',
  });

  const json = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  const accessToken = typeof json.access_token === 'string' ? json.access_token.trim() : '';
  if (!response.ok || !accessToken) {
    const err = typeof json.error === 'string' ? json.error : `http_${response.status}`;
    throw new Error(`pymthouse signer session exchange failed: ${err}`);
  }

  return {
    accessToken,
    tokenType: typeof json.token_type === 'string' ? json.token_type : 'Bearer',
    ...(typeof json.expires_in === 'number' ? { expiresIn: json.expires_in } : {}),
    ...(typeof json.scope === 'string' ? { scope: json.scope } : {}),
  };
}
