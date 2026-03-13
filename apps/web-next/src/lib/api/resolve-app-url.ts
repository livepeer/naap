import { NextRequest } from 'next/server';

function firstHeaderValue(value: string | null): string | null {
  if (!value) {
    return null;
  }
  const first = value.split(',')[0]?.trim();
  return first || null;
}

/**
 * Resolve the canonical app URL for use in OAuth/OIDC redirect URIs.
 *
 * Priority:
 * 1. callbackOrigin — per-provider value stored in the BillingProvider DB record
 * 2. BILLING_PROVIDER_OAUTH_CALLBACK_ORIGIN env var (global fallback, required in production)
 * 3. x-forwarded-host / host headers from the request
 * 4. http://localhost:3000 fallback (dev only)
 *
 * Pass the provider's callbackOrigin from the DB as the first argument so each
 * billing provider can direct callbacks to a different NaaP origin when needed.
 * When null/undefined, falls back to the env var / header detection logic.
 */
export function resolveAppUrl(request: NextRequest, callbackOrigin?: string | null): string {
  if (callbackOrigin) return callbackOrigin;

  const isProduction =
    process.env.NODE_ENV === 'production' || process.env.VERCEL_ENV === 'production';

  if (isProduction) {
    if (!process.env.BILLING_PROVIDER_OAUTH_CALLBACK_ORIGIN) {
      throw new Error(
        'BILLING_PROVIDER_OAUTH_CALLBACK_ORIGIN must be set in production (or callbackOrigin must be set on the BillingProvider DB record)'
      );
    }
    return process.env.BILLING_PROVIDER_OAUTH_CALLBACK_ORIGIN;
  }

  if (process.env.BILLING_PROVIDER_OAUTH_CALLBACK_ORIGIN) {
    return process.env.BILLING_PROVIDER_OAUTH_CALLBACK_ORIGIN;
  }

  const host = firstHeaderValue(request.headers.get('host'));
  const forwardedHost = firstHeaderValue(request.headers.get('x-forwarded-host'));
  const forwardedProto = firstHeaderValue(request.headers.get('x-forwarded-proto'));

  const isLocalHost = (value: string): boolean =>
    value.includes('localhost') ||
    value.startsWith('127.') ||
    value.startsWith('0.0.0.0') ||
    value.startsWith('[::1]');

  if (host) {
    const useForwardedHost = isLocalHost(host) && !!forwardedHost;
    const resolvedHost = useForwardedHost ? (forwardedHost as string) : host;

    const protocol = isLocalHost(resolvedHost)
      ? (forwardedProto || 'http')
      : 'https';

    return `${protocol}://${resolvedHost}`;
  }

  if (forwardedHost && isLocalHost(forwardedHost)) {
    const protocol = forwardedProto || 'http';
    return `${protocol}://${forwardedHost}`;
  }

  return 'http://localhost:3000';
}
