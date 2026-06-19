/**
 * Shared env config for `@pymthouse/builder-sdk/signer/server` exchange handlers.
 */

import 'server-only';

import { getPymthouseIssuerUrlFromEnv } from '@pymthouse/builder-sdk/config';

/**
 * Validate and normalize an http(s) URL, trimming any trailing slashes.
 * Returns `null` for malformed values so misconfiguration surfaces at config
 * time rather than as an opaque fetch failure at request time.
 */
function normalizeHttpUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return null;
    }
    return url.toString().replace(/\/+$/, '');
  } catch {
    return null;
  }
}

function issuerOriginFromIssuerUrl(issuerUrl: string): string {
  return issuerUrl.replace(/\/api\/v1\/oidc\/?$/i, '').replace(/\/+$/, '');
}

/** Public signer facade URL from `PYMTHOUSE_SIGNER_URL` or `{issuerOrigin}/api/signer`. */
export function resolvePymthouseSignerUrl(): string | null {
  const fromEnv = process.env.PYMTHOUSE_SIGNER_URL?.trim();
  if (fromEnv) {
    return normalizeHttpUrl(fromEnv);
  }
  const issuerUrl = getPymthouseIssuerUrlFromEnv();
  if (!issuerUrl) {
    return null;
  }
  return `${issuerOriginFromIssuerUrl(issuerUrl)}/api/signer`;
}

function readM2mBaseConfig():
  | {
      issuerUrl: string;
      m2mClientId: string;
      m2mClientSecret: string;
      allowInsecureHttp: boolean;
      signerUrl: string;
    }
  | null {
  const issuerUrl = normalizeHttpUrl(process.env.PYMTHOUSE_ISSUER_URL?.trim() ?? '');
  const m2mClientId = process.env.PYMTHOUSE_M2M_CLIENT_ID?.trim();
  const m2mClientSecret = process.env.PYMTHOUSE_M2M_CLIENT_SECRET?.trim();
  if (!issuerUrl || !m2mClientId || !m2mClientSecret) {
    return null;
  }
  const signerUrl = resolvePymthouseSignerUrl();
  if (!signerUrl) {
    return null;
  }
  return {
    issuerUrl,
    m2mClientId,
    m2mClientSecret,
    allowInsecureHttp: process.env.PYMTHOUSE_ALLOW_INSECURE_HTTP === '1',
    signerUrl,
  };
}

export function readDeviceExchangeConfig() {
  return readM2mBaseConfig();
}

export function readApiKeyExchangeConfig() {
  const base = readM2mBaseConfig();
  const publicClientId = process.env.PYMTHOUSE_PUBLIC_CLIENT_ID?.trim();
  if (!base || !publicClientId) {
    return null;
  }
  return {
    ...base,
    publicClientId,
  };
}
