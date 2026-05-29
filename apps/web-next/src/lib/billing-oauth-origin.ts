import type { NextRequest } from 'next/server';

function firstHeaderValue(value: string | null): string | null {
  if (!value) {
    return null;
  }
  const first = value.split(',')[0]?.trim();
  return first || null;
}

/** Canonical NaaP origin for billing OAuth redirect_uri (must match authorize request). */
export function resolveBillingOAuthAppUrl(request: NextRequest): string {
  const isProduction =
    process.env.NODE_ENV === 'production' || process.env.VERCEL_ENV === 'production';

  if (isProduction) {
    if (!process.env.BILLING_PROVIDER_OAUTH_CALLBACK_ORIGIN) {
      throw new Error('BILLING_PROVIDER_OAUTH_CALLBACK_ORIGIN must be set in production');
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
