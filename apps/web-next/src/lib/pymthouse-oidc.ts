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

import { PmtHouseError, toPmtHouseError } from '@pymthouse/builder-api';

import { getPmtHouseServerClient } from '@/lib/pymthouse-client';
import {
  getPymthousePublicClientId,
  isPymthouseConfigured,
  PYMTHOUSE_NOT_CONFIGURED_MESSAGE,
} from '@/lib/pymthouse-env';

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
