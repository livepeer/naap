/**
 * PymtHouse environment reads (no SDK, no `server-only`).
 * Safe for middleware and shared route code.
 */

const TRAILING_SLASH = /\/+$/;

/** Operator hint when Builder / Usage cannot run. */
export const PYMTHOUSE_NOT_CONFIGURED_MESSAGE =
  'PymtHouse is not configured. Set PYMTHOUSE_ISSUER_URL, PYMTHOUSE_PUBLIC_CLIENT_ID, PYMTHOUSE_M2M_CLIENT_ID, and PYMTHOUSE_M2M_CLIENT_SECRET, then restart.';

export function getPymthouseIssuerUrl(): string | null {
  const raw = process.env.PYMTHOUSE_ISSUER_URL?.trim();
  if (!raw) return null;
  return raw.replace(TRAILING_SLASH, '');
}

export function getPymthousePublicClientId(): string | null {
  const raw = process.env.PYMTHOUSE_PUBLIC_CLIENT_ID?.trim();
  return raw || null;
}

export function getPymthouseM2mClientId(): string | null {
  return process.env.PYMTHOUSE_M2M_CLIENT_ID?.trim() || null;
}

export function getPymthouseM2mClientSecret(): string | null {
  return process.env.PYMTHOUSE_M2M_CLIENT_SECRET?.trim() || null;
}

/** True when all vars required by `createPmtHouseClientFromEnv` are present. */
export function isPymthouseConfigured(): boolean {
  return Boolean(
    getPymthouseIssuerUrl() &&
      getPymthousePublicClientId() &&
      getPymthouseM2mClientId() &&
      getPymthouseM2mClientSecret(),
  );
}
