/**
 * PymtHouse Builder API helpers for NaaP → PymtHouse server-to-server.
 *
 * Uses `@pymthouse/builder-api` (`PmtHouseClient`) for Builder + OIDC token endpoint
 * (oauth4webapi). Mints short-lived user-scoped JWTs (`scope: "sign:job"`) via
 * `externalUserId = naapUserId`.
 *
 * Env (see SDK `createPmtHouseClientFromEnv`): `PYMTHOUSE_ISSUER_URL`,
 * `PYMTHOUSE_PUBLIC_CLIENT_ID`, `PYMTHOUSE_M2M_CLIENT_ID`, `PYMTHOUSE_M2M_CLIENT_SECRET`.
 */

import 'server-only';

import {
  PmtHouseError,
  toPmtHouseError,
  type TokenExchangeResponse,
} from '@pymthouse/builder-api';

import { getPmtHouseServerClient } from '@/lib/pymthouse-client';
import {
  getPymthouseIssuerUrl,
  getPymthousePublicClientId,
  isPymthouseConfigured,
  PYMTHOUSE_NOT_CONFIGURED_MESSAGE,
} from '@/lib/pymthouse-env';

/** Only scope NaaP ever hands to an end user. */
export const PYMTHOUSE_USER_TOKEN_SCOPE = 'sign:job';

/** RFC 6749 `token_type` value returned alongside PymtHouse JWTs. */
export const PYMTHOUSE_TOKEN_TYPE = 'Bearer';

/** Matches PymtHouse `gateway-token-exchange.ts` signer session TTL. */
export const PYMTHOUSE_SIGNER_SESSION_EXPIRES_IN_SEC = 90 * 24 * 60 * 60;

export const PYMTHOUSE_SIGNER_SESSION_TTL_MS =
  PYMTHOUSE_SIGNER_SESSION_EXPIRES_IN_SEC * 1000;

export interface PymthouseUserAccessToken {
  accessToken: string;
  tokenType: typeof PYMTHOUSE_TOKEN_TYPE;
  expiresIn: number;
  scope: typeof PYMTHOUSE_USER_TOKEN_SCOPE;
}

export { getPymthousePublicClientId, isPymthouseConfigured } from '@/lib/pymthouse-env';

function mapMintResponseToAccessToken(res: {
  access_token: string;
  expires_in: number;
  scope: string;
}): PymthouseUserAccessToken {
  const returnedScope = typeof res.scope === 'string' ? res.scope.trim() : '';
  if (returnedScope !== PYMTHOUSE_USER_TOKEN_SCOPE) {
    throw new Error(
      `PymtHouse user token has unexpected scope "${returnedScope}"; expected "${PYMTHOUSE_USER_TOKEN_SCOPE}"`,
    );
  }
  const expiresIn =
    typeof res.expires_in === 'number' && res.expires_in > 0
      ? Math.floor(res.expires_in)
      : 15 * 60;
  return {
    accessToken: res.access_token,
    tokenType: PYMTHOUSE_TOKEN_TYPE,
    expiresIn,
    scope: PYMTHOUSE_USER_TOKEN_SCOPE,
  };
}

/**
 * Upsert the NaaP user on PymtHouse and return a fresh short-lived `sign:job`
 * JWT for that user.
 */
export async function issuePymthouseUserAccessToken(
  naapUserId: string,
  opts?: { email?: string },
): Promise<PymthouseUserAccessToken> {
  if (!isPymthouseConfigured()) {
    throw new Error(PYMTHOUSE_NOT_CONFIGURED_MESSAGE);
  }

  const client = getPmtHouseServerClient();
  try {
    await client.upsertAppUser({
      externalUserId: naapUserId,
      email: opts?.email,
      status: 'active',
    });
    const json = await client.mintUserAccessToken({
      externalUserId: naapUserId,
      scope: PYMTHOUSE_USER_TOKEN_SCOPE,
    });
    return mapMintResponseToAccessToken(json);
  } catch (e) {
    const err = toPmtHouseError(e, 'PymtHouse user token mint failed');
    throw new Error(err.message);
  }
}

export interface PymthouseSignerSessionToken {
  accessToken: string;
  tokenType: string;
  expiresIn: number;
  scope: string;
}

function mapSignerSessionResponse(
  res: TokenExchangeResponse,
): PymthouseSignerSessionToken {
  const accessToken =
    typeof res.access_token === 'string' ? res.access_token.trim() : '';
  if (!accessToken) {
    throw new Error('PymtHouse signer session exchange returned no access_token');
  }
  if (accessToken.startsWith('eyJ')) {
    throw new Error(
      'PymtHouse signer session exchange returned a JWT; expected opaque signer session token',
    );
  }

  const tokenType =
    typeof res.token_type === 'string' && res.token_type.trim()
      ? res.token_type.trim()
      : PYMTHOUSE_TOKEN_TYPE;
  const expiresIn =
    typeof res.expires_in === 'number' &&
    Number.isFinite(res.expires_in) &&
    res.expires_in > 0
      ? Math.floor(res.expires_in)
      : PYMTHOUSE_SIGNER_SESSION_EXPIRES_IN_SEC;
  const scope =
    typeof res.scope === 'string' && res.scope.trim()
      ? res.scope.trim()
      : PYMTHOUSE_USER_TOKEN_SCOPE;

  return {
    accessToken,
    tokenType,
    expiresIn,
    scope,
  };
}

/**
 * RFC 8693 token exchange at the PymtHouse issuer: swap a short-lived Builder-minted
 * user JWT for a long-lived opaque `pmth_…` signer session token using the SDK.
 */
export async function exchangePymthouseUserTokenForSignerSession(
  shortLivedUserJwt: string,
): Promise<PymthouseSignerSessionToken> {
  const issuer = getPymthouseIssuerUrl();
  if (!issuer || !isPymthouseConfigured()) {
    throw new Error(PYMTHOUSE_NOT_CONFIGURED_MESSAGE);
  }

  const client = getPmtHouseServerClient();
  try {
    const json = await client.exchangeForSignerSession({
      userJwt: shortLivedUserJwt,
      resource: issuer,
    });
    return mapSignerSessionResponse(json);
  } catch (e) {
    const err = toPmtHouseError(e, 'PymtHouse signer session exchange failed');
    throw new Error(err.message);
  }
}

/**
 * Upsert NaaP user on PymtHouse, then mint + exchange via the Builder API SDK
 * (`mintUserSignerSessionToken`) for the durable opaque token.
 */
export async function mintPymthouseSignerSessionForNaapUser(
  naapUserId: string,
  opts?: { email?: string },
): Promise<PymthouseSignerSessionToken> {
  const issuer = getPymthouseIssuerUrl();
  if (!issuer || !isPymthouseConfigured()) {
    throw new Error(PYMTHOUSE_NOT_CONFIGURED_MESSAGE);
  }

  const client = getPmtHouseServerClient();
  try {
    await client.upsertAppUser({
      externalUserId: naapUserId,
      email: opts?.email,
      status: 'active',
    });
    const json = await client.mintUserSignerSessionToken({
      externalUserId: naapUserId,
      scope: PYMTHOUSE_USER_TOKEN_SCOPE,
      resource: issuer,
    });
    return mapSignerSessionResponse(json);
  } catch (e) {
    const err = toPmtHouseError(e, 'PymtHouse signer session mint failed');
    throw new Error(err.message);
  }
}
export type PymthouseDeviceApproveResult =
  | { ok: true }
  | { ok: false; status: number; message: string };

/**
 * Approve a pending device code: mint user JWT via Builder, then RFC 8693 token exchange at issuer.
 */
export async function approvePymthouseDeviceCode(params: {
  publicClientId: string;
  userCode: string;
  externalUserId: string;
  email?: string | null;
}): Promise<PymthouseDeviceApproveResult> {
  if (!isPymthouseConfigured()) {
    return {
      ok: false,
      status: 500,
      message: PYMTHOUSE_NOT_CONFIGURED_MESSAGE,
    };
  }

  if (params.publicClientId !== getPymthousePublicClientId()) {
    return {
      ok: false,
      status: 400,
      message: 'publicClientId does not match PYMTHOUSE_PUBLIC_CLIENT_ID',
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

  const client = getPmtHouseServerClient();
  try {
    await client.completeDeviceApproval({
      userJwt: subjectToken,
      userCode: params.userCode,
    });
    return { ok: true };
  } catch (e) {
    if (e instanceof PmtHouseError) {
      return { ok: false, status: e.status, message: e.message };
    }
    const err = toPmtHouseError(e, 'Device approval token exchange failed');
    return { ok: false, status: err.status, message: err.message };
  }
}
