/**
 * PymtHouse user API key helpers (Dashboard parity).
 * Mints long-lived pmth_* keys via PymtHouse Builder Apps API for SDK/CLI exchange.
 */

import 'server-only';

import { PmtHouseError } from '@pymthouse/builder-sdk';

export type PymthouseApiKeyRow = {
  id: string;
  label: string | null;
  prefix: string;
  suffix: string;
  status: string;
  createdAt: string;
  revokedAt: string | null;
};

function readPublicClientId(): string {
  const id = process.env.PYMTHOUSE_PUBLIC_CLIENT_ID?.trim();
  if (!id) {
    throw new PmtHouseError('PYMTHOUSE_PUBLIC_CLIENT_ID is required', {
      status: 503,
      code: 'pymthouse_required',
    });
  }
  return id;
}

function readM2mAuthHeader(): string {
  const m2mId = process.env.PYMTHOUSE_M2M_CLIENT_ID?.trim();
  const m2mSecret = process.env.PYMTHOUSE_M2M_CLIENT_SECRET?.trim();
  if (!m2mId || !m2mSecret) {
    throw new PmtHouseError(
      'PYMTHOUSE_M2M_CLIENT_ID and PYMTHOUSE_M2M_CLIENT_SECRET are required',
      { status: 503, code: 'pymthouse_required' },
    );
  }
  return `Basic ${Buffer.from(`${m2mId}:${m2mSecret}`).toString('base64')}`;
}

function appsOrigin(): string {
  const issuerUrl = process.env.PYMTHOUSE_ISSUER_URL?.trim();
  if (!issuerUrl) {
    throw new PmtHouseError('PYMTHOUSE_ISSUER_URL is required', {
      status: 503,
      code: 'pymthouse_required',
    });
  }
  return issuerUrl.replace(/\/api\/v1\/oidc\/?$/i, '').replace(/\/+$/, '');
}

function userKeysUrl(publicClientId: string, externalUserId: string): string {
  return `${appsOrigin()}/api/v1/apps/${encodeURIComponent(publicClientId)}/users/${encodeURIComponent(externalUserId)}/keys`;
}

async function readErrorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: string; error_description?: string };
    return body.error_description ?? body.error ?? `Request failed (${response.status})`;
  } catch {
    return `Request failed (${response.status})`;
  }
}

export async function ensureAppUserProvisioned(
  publicClientId: string,
  externalUserId: string,
  email?: string | null,
): Promise<void> {
  const response = await fetch(
    `${appsOrigin()}/api/v1/apps/${encodeURIComponent(publicClientId)}/users`,
    {
      method: 'POST',
      headers: {
        Authorization: readM2mAuthHeader(),
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        externalUserId,
        email: email?.trim() || externalUserId,
        status: 'active',
      }),
      cache: 'no-store',
      // Fail fast instead of hanging if the Builder Apps API is unresponsive.
      signal: AbortSignal.timeout(10_000),
    },
  );
  if (!response.ok && response.status !== 409) {
    throw new PmtHouseError(await readErrorMessage(response), {
      status: response.status,
      code: 'app_user_provision_failed',
    });
  }
}

export async function createPymthouseApiKey(input: {
  externalUserId: string;
  email?: string | null;
  label?: string;
}): Promise<{ apiKey: string; row: PymthouseApiKeyRow }> {
  const publicClientId = readPublicClientId();
  await ensureAppUserProvisioned(publicClientId, input.externalUserId, input.email);

  const response = await fetch(userKeysUrl(publicClientId, input.externalUserId), {
    method: 'POST',
    headers: {
      Authorization: readM2mAuthHeader(),
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input.label ? { label: input.label } : {}),
    cache: 'no-store',
    // Fail fast instead of hanging if the Builder Apps API is unresponsive.
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    throw new PmtHouseError(await readErrorMessage(response), {
      status: response.status,
      code: 'api_key_create_failed',
    });
  }

  const body = (await response.json()) as {
    apiKey: string;
    id: string;
    prefix: string;
    suffix: string;
    label: string | null;
    createdAt: string;
  };

  return {
    apiKey: body.apiKey,
    row: {
      id: body.id,
      label: body.label,
      prefix: body.prefix,
      suffix: body.suffix,
      status: 'active',
      createdAt: body.createdAt,
      revokedAt: null,
    },
  };
}
