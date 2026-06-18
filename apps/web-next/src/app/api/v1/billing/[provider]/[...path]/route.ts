/**
 * Generic billing provider routing (NAAP-A).
 *
 *   GET  /api/v1/billing/{provider}/usage
 *   POST /api/v1/billing/{provider}/token
 *
 * Delegates to the BillingProviderAdapter registry instead of any hardcoded
 * provider. Gated behind the `provider_adapters` flag (default OFF): when OFF this
 * route is a no-op (404), so the existing /api/v1/billing/pymthouse/* routes are
 * the only billing surface and their behavior is unchanged. Zero regression.
 *
 * Never logs secrets/tokens/PII — only request metadata + correlation id.
 */

import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';

import { validateSession } from '@/lib/api/auth';
import { validateCSRF } from '@/lib/api/csrf';
import { enforceRateLimit } from '@/lib/api/rate-limit';
import { error, errors, getAuthToken, success } from '@/lib/api/response';
import { isFeatureEnabled } from '@/lib/feature-flags';
import { AdapterNotImplementedError, type BillingProviderAdapter } from '@/lib/billing/adapter';
import { resolveBillingProviderAdapterDetailed } from '@/lib/billing/registry-db';

const PROVIDER_ADAPTERS_FLAG = 'provider_adapters';
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_PER_USER = 30;
const PROVIDER_SLUG_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;

type Params = { params: Promise<{ provider: string; path?: string[] }> };

function noStore(res: NextResponse): NextResponse {
  res.headers.set('Cache-Control', 'no-store');
  return res;
}

function correlationIdOf(request: NextRequest): string {
  return request.headers.get('x-request-id')?.trim() || randomUUID();
}

function log(
  level: 'info' | 'warn' | 'error',
  event: string,
  fields: Record<string, unknown>,
): void {
  const line = JSON.stringify({ level, event, ...fields });
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.info(line);
}

function isSystemAdmin(roles: string[] | undefined): boolean {
  return Boolean(roles?.includes('system:admin'));
}

/** Drop crypto-unit fields (wei/eth/gwei) so raw on-chain amounts are not exposed. */
function stripCryptoUnitFields(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripCryptoUnitFields);
  if (!value || typeof value !== 'object') return value;
  const units = ['wei', 'eth', 'gwei'];
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    const lower = key.toLowerCase();
    if (units.some((u) => lower === u || lower.endsWith(u))) continue;
    out[key] = stripCryptoUnitFields(entry);
  }
  return out;
}

/**
 * Strict calendar-date (YYYY-MM-DD) or ISO 8601 date-time; returns null when
 * invalid/empty. The explicit format gate rejects the permissive/ambiguous
 * inputs `Date.parse` would otherwise accept, keeping filtering consistent
 * across clients and environments.
 */
const ISO_DATE_RE =
  /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})?)?$/;
function parseDateParam(raw: string | null): string | null {
  if (raw == null) return null;
  const v = raw.trim();
  if (v === '') return null;
  if (!ISO_DATE_RE.test(v)) return null;
  const ts = Date.parse(v);
  if (Number.isNaN(ts)) return null;
  return v;
}

/** Current UTC calendar-month [from, to] as ISO strings. */
function currentUtcMonthBounds(): { startDate: string; endDate: string } {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0, 23, 59, 59, 999));
  return { startDate: start.toISOString(), endDate: end.toISOString() };
}

function mapAdapterError(
  e: unknown,
  provider: string,
  correlationId: string,
  event: string,
): NextResponse {
  if (e instanceof AdapterNotImplementedError) {
    log('warn', event, { provider, correlationId, reason: 'not_implemented', method: e.method });
    return error('NOT_IMPLEMENTED', 'Operation not supported by this provider', 501);
  }
  const errorType = e instanceof Error ? e.name : 'UnknownError';
  log('error', event, { provider, correlationId, errorType });
  return errors.serviceUnavailable('Billing provider request failed');
}

interface RouteCtx {
  request: NextRequest;
  provider: string;
  adapter: BillingProviderAdapter;
  correlationId: string;
  user: { id: string; email?: string | null; roles?: string[] };
}

async function handleUsage(ctx: RouteCtx): Promise<NextResponse> {
  const { request, provider, adapter, correlationId, user } = ctx;
  const sp = request.nextUrl.searchParams;

  const scope = (sp.get('scope') ?? 'me').trim().toLowerCase();
  if (scope !== 'me' && scope !== 'app') {
    return noStore(errors.badRequest('Invalid scope; use me or app'));
  }

  const startRaw = sp.get('startDate');
  const endRaw = sp.get('endDate');
  const hasStart = startRaw != null && startRaw.trim() !== '';
  const hasEnd = endRaw != null && endRaw.trim() !== '';
  if (hasStart !== hasEnd) {
    return noStore(errors.badRequest('startDate and endDate must both be set or both omitted'));
  }

  let startDate: string;
  let endDate: string;
  if (hasStart) {
    const s = parseDateParam(startRaw);
    const e = parseDateParam(endRaw);
    if (!s || !e) return noStore(errors.badRequest('Invalid startDate or endDate'));
    if (Date.parse(s) > Date.parse(e)) {
      return noStore(errors.badRequest('startDate must be <= endDate'));
    }
    startDate = s;
    endDate = e;
  } else {
    ({ startDate, endDate } = currentUtcMonthBounds());
  }

  if (scope === 'me') {
    try {
      const body = await adapter.getUsageForExternalUser({
        externalUserId: user.id,
        startDate,
        endDate,
      });
      log('info', 'billing.adapter.usage', { provider, correlationId, scope, status: 200 });
      return noStore(success(stripCryptoUnitFields(body)));
    } catch (e) {
      return noStore(mapAdapterError(e, provider, correlationId, 'billing.adapter.usage'));
    }
  }

  if (!isSystemAdmin(user.roles)) {
    return noStore(errors.forbidden('App-wide usage requires system:admin'));
  }

  const groupByRaw = sp.get('groupBy')?.trim();
  let groupBy: 'none' | 'user' | undefined;
  if (groupByRaw) {
    if (groupByRaw !== 'none' && groupByRaw !== 'user') {
      return noStore(errors.badRequest('groupBy must be none or user'));
    }
    groupBy = groupByRaw;
  }
  const userId = sp.get('userId')?.trim() || undefined;

  try {
    const usage = await adapter.getAppUsage({ startDate, endDate, groupBy, userId });
    log('info', 'billing.adapter.usage', { provider, correlationId, scope, status: 200 });
    return noStore(success(stripCryptoUnitFields(usage)));
  } catch (e) {
    return noStore(mapAdapterError(e, provider, correlationId, 'billing.adapter.usage'));
  }
}

async function handleToken(ctx: RouteCtx): Promise<NextResponse> {
  const { request, provider, adapter, correlationId, user } = ctx;

  const csrfError = validateCSRF(request);
  if (csrfError) return csrfError;

  const rateLimited = enforceRateLimit(request, {
    keyPrefix: `billing-token:${provider}:${user.id}`,
    windowMs: RATE_LIMIT_WINDOW_MS,
    maxRequests: RATE_LIMIT_MAX_PER_USER,
  });
  if (rateLimited) return rateLimited;

  try {
    const session = await adapter.mintSignerSession({
      externalUserId: user.id,
      email: user.email ?? undefined,
    });
    log('info', 'billing.adapter.token', { provider, correlationId, status: 200 });
    return noStore(
      success({
        access_token: session.accessToken,
        token_type: session.tokenType,
        expires_in: session.expiresIn,
        scope: session.scope,
      }),
    );
  } catch (e) {
    return noStore(mapAdapterError(e, provider, correlationId, 'billing.adapter.token'));
  }
}

async function resolve(
  request: NextRequest,
  ctx: Params,
  method: 'GET' | 'POST',
): Promise<NextResponse> {
  const correlationId = correlationIdOf(request);
  try {
    // Flag OFF → behave as if this route does not exist (no-op; zero regression).
    if (!(await isFeatureEnabled(PROVIDER_ADAPTERS_FLAG))) {
      return noStore(errors.notFound('Resource'));
    }

    const { provider, path } = await ctx.params;
    if (!PROVIDER_SLUG_RE.test(provider)) {
      return noStore(errors.notFound('Provider'));
    }

    // NAAP-A-db: DB-driven resolution when `db_adapter_registry` is ON; falls
    // back to the static slug→adapter map otherwise (zero-regression).
    const resolution = await resolveBillingProviderAdapterDetailed(provider);
    const adapter = resolution.adapter;
    if (!adapter) {
      log('warn', 'billing.adapter.unknown_provider', {
        provider,
        correlationId,
        source: resolution.source,
      });
      return noStore(errors.notFound('Provider'));
    }
    log('info', 'billing.adapter.resolved', {
      provider,
      correlationId,
      source: resolution.source,
      adapterType: resolution.adapterType,
    });

    // Authenticate before probing provider configuration so unauthenticated
    // callers cannot distinguish "configured" from "not configured" (avoids
    // leaking provider config state and doing work before rejecting).
    const token = getAuthToken(request);
    if (!token) return noStore(errors.unauthorized('No auth token provided'));
    const sessionUser = await validateSession(token);
    if (!sessionUser) return noStore(errors.unauthorized('Invalid or expired session'));

    if (!adapter.isConfigured()) {
      return noStore(errors.badRequest(`Provider "${provider}" is not configured`));
    }

    const op = (path?.[0] ?? '').toLowerCase();
    const routeCtx: RouteCtx = {
      request,
      provider,
      adapter,
      correlationId,
      user: { id: sessionUser.id, email: sessionUser.email, roles: sessionUser.roles },
    };

    if (method === 'GET' && op === 'usage') return handleUsage(routeCtx);
    if (method === 'POST' && op === 'token') return handleToken(routeCtx);

    return noStore(errors.notFound('Billing operation'));
  } catch (err) {
    log('error', 'billing.adapter.unexpected', {
      correlationId,
      errorType: err instanceof Error ? err.name : 'UnknownError',
    });
    return noStore(errors.internal('Billing request failed'));
  }
}

export async function GET(request: NextRequest, ctx: Params): Promise<NextResponse> {
  return resolve(request, ctx, 'GET');
}

export async function POST(request: NextRequest, ctx: Params): Promise<NextResponse> {
  return resolve(request, ctx, 'POST');
}
