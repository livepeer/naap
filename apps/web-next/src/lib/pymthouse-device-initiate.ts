/**
 * PymtHouse OIDC device-flow third-party initiate login (OIDC Core).
 *
 * When the OP redirects the browser here with iss + target_link_uri, middleware validates,
 * stores a short-lived http-only cookie with { user_code, public_client_id }, and sends the
 * user through login to `/oidc/device-approved` where NaaP completes RFC 8693 device approval at PymtHouse `{issuer}/token`.
 */

import { getPymthousePublicClientId } from '@/lib/pymthouse-env';

export const NAAP_PMTH_DEVICE_APPROVAL_COOKIE = 'naap_pmth_device_approval';

/** HttpOnly cookie: OIDC `login_hint` for device-flow login prefill (not echoed in `/login` query). */
export const NAAP_DEVICE_LOGIN_HINT_COOKIE = 'naap_device_login_hint';

function stripTrailingSlashes(url: string): string {
  return url.replace(/\/+$/, '');
}

/** Expected issuer URL (no trailing slash), from PYMTHOUSE_ISSUER_URL. */
export function getExpectedPymthouseIssuer(): string | null {
  const raw = process.env.PYMTHOUSE_ISSUER_URL?.trim();
  if (!raw) return null;
  try {
    return stripTrailingSlashes(new URL(raw).href);
  } catch {
    return null;
  }
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
  return getPymthouseIssuerOrigin();
}

/**
 * Origin of the OIDC issuer (OP host). `/oidc/device` lives on this origin; device-flow
 * validation must use this — not `PMTHOUSE_BASE_URL` alone, which is often NaaP's origin for
 * marketplace/API helpers and would mismatch PymtHouse's device URL.
 */
export function getPymthouseIssuerOrigin(): string | null {
  const iss = getExpectedPymthouseIssuer();
  if (!iss) return null;
  try {
    return new URL(iss).origin;
  } catch {
    return null;
  }
}

function normalizeIssuerUrl(iss: string): string {
  try {
    return stripTrailingSlashes(new URL(iss.trim()).href);
  } catch {
    return iss.trim();
  }
}

export type ValidateDeviceInitiateResult =
  | { ok: true; returnUrl: string }
  | { ok: false; reason: string };

/**
 * Validate OP-issued iss + target_link_uri before setting the approval cookie or redirecting.
 */
export function validatePymthouseDeviceInitiateQuery(
  iss: string,
  targetLinkUri: string,
): ValidateDeviceInitiateResult {
  const expectedIss = getExpectedPymthouseIssuer();
  const opOrigin = getPymthouseIssuerOrigin();
  if (!expectedIss || !opOrigin) {
    return { ok: false, reason: 'server_not_configured' };
  }
  if (normalizeIssuerUrl(iss) !== normalizeIssuerUrl(expectedIss)) {
    return { ok: false, reason: 'iss_mismatch' };
  }
  let target: URL;
  try {
    target = new URL(targetLinkUri);
  } catch {
    return { ok: false, reason: 'bad_target_uri' };
  }
  if (target.origin !== opOrigin) {
    return { ok: false, reason: 'target_origin_mismatch' };
  }
  if (target.pathname !== '/oidc/device') {
    return { ok: false, reason: 'target_path_mismatch' };
  }
  if (target.hash) {
    return { ok: false, reason: 'target_has_hash' };
  }
  return { ok: true, returnUrl: target.href };
}

const USER_CODE_RE = /^[A-Z0-9-]{4,16}$/;

export type DeviceApprovalTuple =
  | { userCode: string; publicClientId: string }
  | { error: string };

/**
 * Parse PymtHouse `/oidc/device` URL query for user_code + client_id (public SDK client).
 */
export function extractDeviceApprovalTupleFromTargetLink(targetHref: string): DeviceApprovalTuple {
  let target: URL;
  try {
    target = new URL(targetHref);
  } catch {
    return { error: 'bad_target_uri' };
  }
  const opOrigin = getPymthouseIssuerOrigin();
  if (!opOrigin || target.origin !== opOrigin) {
    return { error: 'target_origin_mismatch' };
  }
  if (target.pathname !== '/oidc/device') {
    return { error: 'target_path_mismatch' };
  }
  const userCodeRaw = target.searchParams.get('user_code')?.trim() ?? '';
  const clientIdRaw = target.searchParams.get('client_id')?.trim() ?? '';
  if (!userCodeRaw || !USER_CODE_RE.test(userCodeRaw)) {
    return { error: 'invalid_user_code' };
  }
  if (!clientIdRaw || !clientIdRaw.startsWith('app_')) {
    return { error: 'invalid_client_id' };
  }
  const expectedPublic = getPymthousePublicClientId();
  if (expectedPublic && clientIdRaw !== expectedPublic) {
    return { error: 'client_id_mismatch' };
  }
  return { userCode: userCodeRaw, publicClientId: clientIdRaw };
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

async function signCookiePayload(serializedPayload: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(serializedPayload),
  );
  return bytesToBase64Url(new Uint8Array(signature));
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
    const expectedSignature = await signCookiePayload(serializedPayload, secret);
    if (providedSignature !== expectedSignature) {
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
    if (!USER_CODE_RE.test(userCode)) return null;
    if (Date.now() > exp) return null;
    return { userCode, publicClientId, exp };
  } catch {
    return null;
  }
}
