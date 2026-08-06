/**
 * M2M call to pymthouse `POST /apps/{publicClientId}/billing/checkout`.
 *
 * The published `@pymthouse/builder-sdk` pin does not yet expose this verb, so
 * NaaP calls it with the same Basic-auth pattern as discovery-plans. Secrets
 * are used only to build the Authorization header and are never logged.
 */

import 'server-only';

import { getPymthouseApiV1Base } from '@/lib/pymthouse-device-initiate';

import type { PymthouseDiscoveryPlansCreds } from '@/lib/pymthouse-discovery-plans';

export type PymthouseBillingCheckoutCreds = PymthouseDiscoveryPlansCreds;

export interface CreatePymthouseBillingCheckoutInput {
  planId: string;
  externalUserId: string;
  successUrl?: string;
  cancelUrl?: string;
}

export interface PymthouseBillingCheckoutResult {
  checkoutUrl: string;
  /** Opaque provider subscription pointer when the provider returns one. */
  subscriptionRef?: string;
}

/** Provider/HTTP failure from checkout — carries a suggested HTTP status. */
export class PymthouseCheckoutError extends Error {
  readonly status: number;

  constructor(
    message: string,
    status: number,
  ) {
    super(message);
    this.name = 'PymthouseCheckoutError';
    this.status = status;
  }
}

/** Resolve global-env M2M checkout creds (null when incomplete). */
export function resolveGlobalPymthouseBillingCheckoutCreds(): PymthouseBillingCheckoutCreds | null {
  const apiV1Base = getPymthouseApiV1Base()?.trim() ?? '';
  const publicClientId =
    process.env.PYMTHOUSE_PUBLIC_CLIENT_ID?.trim() ||
    process.env.PMTHOUSE_CLIENT_ID?.trim() ||
    '';
  const m2mClientId =
    process.env.PYMTHOUSE_M2M_CLIENT_ID?.trim() ||
    process.env.PMTHOUSE_M2M_CLIENT_ID?.trim() ||
    '';
  const m2mClientSecret =
    process.env.PYMTHOUSE_M2M_CLIENT_SECRET?.trim() ||
    process.env.PMTHOUSE_M2M_CLIENT_SECRET?.trim() ||
    '';
  if (!apiV1Base || !publicClientId || !m2mClientId || !m2mClientSecret) {
    return null;
  }
  return { apiV1Base, publicClientId, m2mClientId, m2mClientSecret };
}

/**
 * Start end-user plan checkout on pymthouse. Throws
 * {@link PymthouseCheckoutError} on non-2xx / malformed responses.
 */
export async function createPymthouseBillingCheckout(
  creds: PymthouseBillingCheckoutCreds,
  input: CreatePymthouseBillingCheckoutInput,
  signal?: AbortSignal,
): Promise<PymthouseBillingCheckoutResult> {
  const planId = input.planId.trim();
  const externalUserId = input.externalUserId.trim();
  if (!planId || !externalUserId) {
    throw new PymthouseCheckoutError('planId and externalUserId are required', 400);
  }

  const basic = Buffer.from(
    `${creds.m2mClientId}:${creds.m2mClientSecret}`,
    'utf8',
  ).toString('base64');
  const url = `${creds.apiV1Base.replace(/\/$/, '')}/apps/${encodeURIComponent(creds.publicClientId)}/billing/checkout`;

  const body: Record<string, string> = { planId, externalUserId };
  if (input.successUrl?.trim()) body.successUrl = input.successUrl.trim();
  if (input.cancelUrl?.trim()) body.cancelUrl = input.cancelUrl.trim();

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(body),
      signal,
      cache: 'no-store',
    });
  } catch {
    throw new PymthouseCheckoutError('Checkout request failed', 502);
  }

  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }

  if (!res.ok) {
    const errMsg =
      json &&
      typeof json === 'object' &&
      typeof (json as { error?: unknown }).error === 'string'
        ? (json as { error: string }).error.trim()
        : '';
    const status = res.status >= 400 && res.status < 600 ? res.status : 502;
    throw new PymthouseCheckoutError(errMsg || 'Checkout failed', status);
  }

  const checkoutUrl =
    json &&
    typeof json === 'object' &&
    typeof (json as { checkoutUrl?: unknown }).checkoutUrl === 'string'
      ? (json as { checkoutUrl: string }).checkoutUrl.trim()
      : '';
  if (!checkoutUrl) {
    throw new PymthouseCheckoutError('Checkout response missing checkoutUrl', 502);
  }

  const subscriptionId =
    json &&
    typeof json === 'object' &&
    typeof (json as { subscriptionId?: unknown }).subscriptionId === 'string'
      ? (json as { subscriptionId: string }).subscriptionId.trim()
      : '';

  return {
    checkoutUrl,
    ...(subscriptionId ? { subscriptionRef: subscriptionId } : {}),
  };
}
