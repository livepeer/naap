/**
 * PymtHouse OIDC device-flow third-party initiate login (OIDC Core).
 *
 * Cookie signing stays in NaaP; validation uses `@pymthouse/builder-sdk/device-initiate`.
 */

import {
  getBuilderApiV1BaseFromIssuerUrl,
  getPymthouseIssuerOrigin,
  getPymthouseIssuerUrlFromEnv,
  getPymthousePublicClientIdFromEnv,
  readPymthouseEnv,
} from '@pymthouse/builder-sdk/config';
import {
  extractDeviceApprovalFromTargetLink,
  validateDeviceInitiateLogin,
  type ValidateDeviceInitiateResult,
} from '@pymthouse/builder-sdk/device-initiate';

export const NAAP_PMTH_DEVICE_APPROVAL_COOKIE = 'naap_pmth_device_approval';

/** HttpOnly cookie: OIDC `login_hint` for device-flow login prefill (not echoed in `/login` query). */
export const NAAP_DEVICE_LOGIN_HINT_COOKIE = 'naap_device_login_hint';

/** Expected issuer URL (no trailing slash), from `PYMTHOUSE_ISSUER_URL`. */
export function getExpectedPymthouseIssuer(): string | null {
  return getPymthouseIssuerUrlFromEnv();
}

/** Site origin for PymtHouse (e.g. http://localhost:3001). */
export function getExpectedPymthouseSiteOrigin(): string | null {
  const base = process.env.PMTHOUSE_BASE_URL?.trim();
  if (base) {
    try {
      return new URL(base).origin;
    } catch {
      /* fall through */
    }
  }
  return getPymthouseIssuerOriginFromEnv();
}

/** Origin of the OIDC issuer (OP host). */
export function getPymthouseIssuerOriginFromEnv(): string | null {
  const iss = getExpectedPymthouseIssuer();
  if (!iss) return null;
  try {
    return getPymthouseIssuerOrigin(iss);
  } catch {
    return null;
  }
}

export function getPymthousePublicClientId(): string | null {
  return getPymthousePublicClientIdFromEnv();
}

export type { ValidateDeviceInitiateResult };

export function validatePymthouseDeviceInitiateQuery(
  iss: string,
  targetLinkUri: string,
): ValidateDeviceInitiateResult {
  const expectedIss = getExpectedPymthouseIssuer();
  if (!expectedIss || !getPymthouseIssuerOriginFromEnv()) {
    return { ok: false, reason: 'server_not_configured' };
  }
  return validateDeviceInitiateLogin({
    expectedIssuerUrl: expectedIss,
    iss,
    targetLinkUri,
  });
}

export type DeviceApprovalTuple =
  | { userCode: string; publicClientId: string }
  | { error: string };

export function extractDeviceApprovalTupleFromTargetLink(
  targetHref: string,
): DeviceApprovalTuple {
  const expectedIss = getExpectedPymthouseIssuer();
  return extractDeviceApprovalFromTargetLink(targetHref, {
    expectedIssuerUrl: expectedIss ?? undefined,
    expectedPublicClientId: getPymthousePublicClientId() ?? undefined,
  });
}

export function getPymthouseApiV1Base(): string | null {
  const issuerUrl = getPymthouseIssuerUrlFromEnv();
  if (!issuerUrl) return null;
  return getBuilderApiV1BaseFromIssuerUrl(issuerUrl);
}

export interface DeviceApprovalCookiePayload {
  userCode: string;
  publicClientId: string;
  exp: number;
}

function getDeviceApprovalCookieSecret(): string | null {
  const secret =
    process.env.PYMTHOUSE_DEVICE_COOKIE_SECRET?.trim() ||
    process.env.NEXTAUTH_SECRET?.trim() ||
    null;
  return secret && secret.length > 0 ? secret : null;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  const base64 =
    typeof btoa === 'function'
      ? btoa(binary)
      : Buffer.from(binary, 'binary').toString('base64');
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlToBytes(value: string): Uint8Array | null {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  try {
    const binary =
      typeof atob === 'function'
        ? atob(padded)
        : Buffer.from(padded, 'base64').toString('binary');
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  } catch {
    return null;
  }
}

async function importCookieSigningKey(
  secret: string,
  usages: KeyUsage[],
): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    usages,
  );
}

async function signCookiePayload(serializedPayload: string, secret: string): Promise<string> {
  const key = await importCookieSigningKey(secret, ['sign']);
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(serializedPayload),
  );
  return bytesToBase64Url(new Uint8Array(signature));
}

async function verifyCookieSignature(
  serializedPayload: string,
  providedSignatureBytes: Uint8Array,
  secret: string,
): Promise<boolean> {
  const key = await importCookieSigningKey(secret, ['verify']);
  const signatureBuf = new Uint8Array(providedSignatureBytes);
  return crypto.subtle.verify(
    'HMAC',
    key,
    signatureBuf,
    new TextEncoder().encode(serializedPayload),
  );
}

export async function encodeDeviceApprovalCookiePayload(
  payload: Omit<DeviceApprovalCookiePayload, 'exp'>,
): Promise<string> {
  const secret = getDeviceApprovalCookieSecret();
  if (!secret) {
    throw new Error('Missing PYMTHOUSE_DEVICE_COOKIE_SECRET or NEXTAUTH_SECRET');
  }
  const body: DeviceApprovalCookiePayload = {
    ...payload,
    exp: Date.now() + 10 * 60 * 1000,
  };
  const serializedPayload = bytesToBase64Url(new TextEncoder().encode(JSON.stringify(body)));
  const signature = await signCookiePayload(serializedPayload, secret);
  return `${serializedPayload}.${signature}`;
}

export async function tryParseDeviceApprovalCookie(
  raw: string | undefined,
): Promise<DeviceApprovalCookiePayload | null> {
  if (!raw || raw.length > 8192) return null;
  const secret = getDeviceApprovalCookieSecret();
  if (!secret) {
    console.error('[pymthouse-device-initiate] Missing cookie signing secret');
    return null;
  }
  const separator = raw.lastIndexOf('.');
  if (separator <= 0 || separator === raw.length - 1) return null;
  const serializedPayload = raw.slice(0, separator);
  const providedSignature = raw.slice(separator + 1);
  try {
    const providedBytes = base64UrlToBytes(providedSignature);
    if (!providedBytes) {
      console.warn('[pymthouse-device-initiate] Malformed device approval cookie signature');
      return null;
    }
    const valid = await verifyCookieSignature(serializedPayload, providedBytes, secret);
    if (!valid) {
      console.warn('[pymthouse-device-initiate] Device approval cookie signature mismatch');
      return null;
    }
    const payloadBytes = base64UrlToBytes(serializedPayload);
    if (!payloadBytes) return null;
    const parsed = JSON.parse(new TextDecoder().decode(payloadBytes)) as Record<string, unknown>;
    const userCode = typeof parsed.userCode === 'string' ? parsed.userCode.trim() : '';
    const publicClientId =
      typeof parsed.publicClientId === 'string' ? parsed.publicClientId.trim() : '';
    const exp = typeof parsed.exp === 'number' ? parsed.exp : 0;
    if (!userCode || !publicClientId || !publicClientId.startsWith('app_')) return null;
    if (Date.now() > exp) return null;
    return { userCode, publicClientId, exp };
  } catch {
    return null;
  }
}
