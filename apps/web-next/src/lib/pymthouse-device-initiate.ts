/**
 * PymtHouse OIDC device-flow third-party initiate login (OIDC Core).
 *
 * When the OP redirects the browser here with iss + target_link_uri, middleware validates,
 * stores a short-lived http-only cookie with { user_code, public_client_id }, and sends the
 * user through login to `/oidc/device-approved` where NaaP completes RFC 8693 device approval at PymtHouse `{issuer}/token`.
 */

export const NAAP_PMTH_DEVICE_APPROVAL_COOKIE = 'naap_pmth_device_approval';

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
    return stripTrailingSlashes(raw);
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
  const expectedPublic = process.env.PMTHOUSE_CLIENT_ID?.trim();
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

export function encodeDeviceApprovalCookiePayload(payload: Omit<DeviceApprovalCookiePayload, 'exp'>): string {
  const body: DeviceApprovalCookiePayload = {
    ...payload,
    exp: Date.now() + 10 * 60 * 1000,
  };
  return JSON.stringify(body);
}

export function tryParseDeviceApprovalCookie(
  raw: string | undefined,
): DeviceApprovalCookiePayload | null {
  if (!raw || raw.length > 8192) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const userCode = typeof parsed.userCode === 'string' ? parsed.userCode.trim() : '';
    const publicClientId =
      typeof parsed.publicClientId === 'string' ? parsed.publicClientId.trim() : '';
    const exp = typeof parsed.exp === 'number' ? parsed.exp : 0;
    if (!userCode || !publicClientId || !USER_CODE_RE.test(userCode)) return null;
    if (Date.now() > exp) return null;
    return { userCode, publicClientId, exp };
  } catch {
    return null;
  }
}
