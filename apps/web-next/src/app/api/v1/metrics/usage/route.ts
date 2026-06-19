/**
 * Cross-provider usage dashboard BFF (NAAP-2).
 *
 *   GET /api/v1/metrics/usage?from=ISO&to=ISO[&accountId=…]
 *
 * Aggregates BPP ⑥ usage into a spend view keyed by provider (the "provider
 * column"), so the dashboard can compare spend across ANY number of billing
 * providers. Read-only.
 *
 * Data source is flag-controlled (zero regression):
 *  - `usage_pull` OFF (default): reads pushed `ProviderUsageRecord` rows exactly
 *    as before.
 *  - `usage_pull` ON: PULLS usage live from each pull-capable provider adapter
 *    (e.g. pymthouse via the M2M client) for the caller's authorized scopes, and
 *    falls back to `ProviderUsageRecord` for any scope whose live pull fails or
 *    whose provider cannot be pulled. A pull failure NEVER 500s the dashboard.
 *
 * Auth: a signed-in user (session). Results are scoped to the billing accounts
 * the caller can reach through their team bindings (the NAAP-1 team →
 * `billingAccountRef` linkage). A non-admin caller can NEVER read another
 * account's spend: an `accountId` they cannot reach is rejected, and omitting
 * `accountId` returns only their own accounts. `system:admin` may query any
 * account (matching the app-wide usage precedent in billing/[provider]). This
 * tenant boundary is identical on the pull and DB paths.
 * Gated behind the `usage_ingest` flag (default OFF) → 404 when OFF.
 */

export const runtime = 'nodejs';

import { NextRequest } from 'next/server';
import { randomUUID } from 'node:crypto';

import { prisma } from '@/lib/db';
import { success, errors, getAuthToken } from '@/lib/api/response';
import { validateSession } from '@/lib/api/auth';
import { isFeatureEnabled } from '@/lib/feature-flags';
import { USAGE_INGEST_FLAG, USAGE_PULL_FLAG } from '@/lib/metrics/flags';
import { aggregateSpendByProvider, type UsageRecordLike } from '@/lib/metrics/aggregate';
import {
  listPullCapableProviderSlugs,
  pullSpend,
  spendScopeKey,
  type SpendScopeRef,
} from '@/lib/metrics/usage-pull';

const MAX_RECORDS = 50_000;

const DB_RECORD_SELECT = {
  providerSlug: true,
  accountId: true,
  appId: true,
  sessions: true,
  tickets: true,
  feeWei: true,
  networkFeeUsdMicros: true,
} as const;

function parseDate(raw: string | null): Date | null {
  if (!raw) return null;
  const ts = Date.parse(raw);
  return Number.isNaN(ts) ? null : new Date(ts);
}

function isSystemAdmin(roles: string[] | undefined): boolean {
  return Boolean(roles?.includes('system:admin'));
}

function correlationIdOf(request: NextRequest): string {
  return request.headers.get('x-request-id')?.trim() || randomUUID();
}

/** A provider-agnostic billing-account reference (BPP `billingAccountRef`). */
interface BillingAccountRef {
  providerSlug: string;
  accountId: string;
}

/**
 * The billing-account refs a caller can reach through their team bindings:
 * teams they own plus teams they are a member of, restricted to teams that are
 * actually bound to a billing account. De-duplicated. This is the authorization
 * boundary for spend — a caller can only ever read these accounts' usage.
 */
async function accessibleBillingAccountRefs(userId: string): Promise<BillingAccountRef[]> {
  const teams = await prisma.team.findMany({
    where: {
      billingAccountId: { not: null },
      OR: [{ ownerId: userId }, { members: { some: { userId } } }],
    },
    select: { billingAccountProviderSlug: true, billingAccountId: true },
  });

  const refs: BillingAccountRef[] = [];
  const seen = new Set<string>();
  for (const t of teams) {
    // A usable ref needs BOTH halves; a record's providerSlug is non-null, so a
    // ref missing its slug would match nothing and is dropped defensively.
    if (!t.billingAccountId || !t.billingAccountProviderSlug) continue;
    const key = `${t.billingAccountProviderSlug}\u0000${t.billingAccountId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    refs.push({ providerSlug: t.billingAccountProviderSlug, accountId: t.billingAccountId });
  }
  return refs;
}

/** Read aggregated usage records from the stored `ProviderUsageRecord` rows. */
async function readDbRecords(
  where: Record<string, unknown>,
): Promise<{ records: UsageRecordLike[]; overflow: boolean }> {
  const records = await prisma.providerUsageRecord.findMany({
    where,
    select: DB_RECORD_SELECT,
    // Fetch one past the cap so we can detect (rather than silently truncate)
    // an oversized window that would under-count usage/spend.
    take: MAX_RECORDS + 1,
  });
  return { records, overflow: records.length > MAX_RECORDS };
}

export async function GET(request: NextRequest) {
  if (!(await isFeatureEnabled(USAGE_INGEST_FLAG))) return errors.notFound('Resource');

  const token = getAuthToken(request);
  if (!token) return errors.unauthorized('Authentication required');
  const user = await validateSession(token);
  if (!user) return errors.unauthorized('Invalid or expired token');

  const sp = request.nextUrl.searchParams;
  const from = parseDate(sp.get('from'));
  const to = parseDate(sp.get('to'));
  if ((sp.get('from') && !from) || (sp.get('to') && !to)) {
    return errors.badRequest('from/to must be valid ISO timestamps');
  }
  if (from && to && from > to) {
    return errors.badRequest('from must be on or before to');
  }
  const requestedAccountId = sp.get('accountId')?.trim() || undefined;
  const dateFilter =
    from || to
      ? { windowTo: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } }
      : {};

  // Authorization: scope the query to accounts the caller may read. A trusted
  // query-string `accountId` (the previous behavior) would let any signed-in
  // user read any account's spend — instead we derive the allowed set here.
  const admin = isSystemAdmin(user.roles);
  let scoped: BillingAccountRef[] = [];
  if (!admin) {
    const refs = await accessibleBillingAccountRefs(user.id);
    scoped = refs;
    if (requestedAccountId) {
      scoped = refs.filter((r) => r.accountId === requestedAccountId);
      if (scoped.length === 0) {
        return errors.forbidden('You do not have access to the requested account');
      }
    }
    if (scoped.length === 0) {
      // Caller reaches no billing accounts → nothing to show (never leak others').
      return success({ providers: aggregateSpendByProvider([]) });
    }
  }

  const pullEnabled = await isFeatureEnabled(USAGE_PULL_FLAG);
  const correlationId = correlationIdOf(request);

  // Pulled records (flag ON) accumulate here; the DB backfill is appended after.
  let pulledRecords: UsageRecordLike[] = [];
  let pulledKeys = new Set<string>();

  if (pullEnabled) {
    try {
      const scopes = buildPullScopes({ admin, requestedAccountId, scoped });
      const result = await pullSpend(scopes, { from, to }, { correlationId });
      pulledRecords = result.records;
      pulledKeys = result.pulled;
    } catch (err) {
      // Defensive: pullSpend degrades per scope and should not throw, but if the
      // orchestration itself fails we must still render from the DB (never 500).
      console.warn(
        JSON.stringify({
          level: 'warn',
          event: 'metrics.usage.pull.orchestration_failed',
          correlationId,
          error: err instanceof Error ? err.name : typeof err,
        }),
      );
      pulledRecords = [];
      pulledKeys = new Set<string>();
    }
  }

  // Build the DB where for the remainder NOT served by a successful pull. With
  // the pull flag OFF this reproduces the legacy query exactly.
  const where = buildDbWhere({
    admin,
    requestedAccountId,
    scoped,
    dateFilter,
    pulledKeys,
  });

  let dbRecords: UsageRecordLike[] = [];
  if (where) {
    const { records, overflow } = await readDbRecords(where);
    if (overflow) {
      return errors.badRequest(
        'Too many usage records for this window; narrow the from/to range and retry',
      );
    }
    dbRecords = records;
  }

  const providers = aggregateSpendByProvider([...pulledRecords, ...dbRecords]);
  return success({ providers });
}

/** The scopes to attempt a live pull for, given the caller's authorization. */
function buildPullScopes(ctx: {
  admin: boolean;
  requestedAccountId?: string;
  scoped: BillingAccountRef[];
}): SpendScopeRef[] {
  if (!ctx.admin) {
    // Non-admin: pull exactly the caller's authorized refs (tenant boundary).
    return ctx.scoped.map((r) => ({ providerSlug: r.providerSlug, accountId: r.accountId }));
  }
  // Admin: pull every pull-capable provider, scoped to the requested account
  // when one was given, else app-wide.
  return listPullCapableProviderSlugs().map((providerSlug) => ({
    providerSlug,
    ...(ctx.requestedAccountId ? { accountId: ctx.requestedAccountId } : {}),
  }));
}

/**
 * The DB query (or `null` for "no DB read needed") covering everything NOT served
 * by a successful pull. Successfully-pulled scopes are excluded so pulled and
 * stored rows never double-count.
 */
function buildDbWhere(ctx: {
  admin: boolean;
  requestedAccountId?: string;
  scoped: BillingAccountRef[];
  dateFilter: Record<string, unknown>;
  pulledKeys: Set<string>;
}): Record<string, unknown> | null {
  if (!ctx.admin) {
    // Backfill only the refs we did NOT pull successfully.
    const remaining = ctx.scoped.filter(
      (r) => !ctx.pulledKeys.has(spendScopeKey({ providerSlug: r.providerSlug, accountId: r.accountId })),
    );
    if (remaining.length === 0) return null;
    return {
      OR: remaining.map((r) => ({ providerSlug: r.providerSlug, accountId: r.accountId })),
      ...ctx.dateFilter,
    };
  }

  // Admin: exclude any provider slug fully served by the pull for this scope.
  const pulledSlugs = new Set<string>();
  for (const key of ctx.pulledKeys) {
    pulledSlugs.add(key.split('\u0000')[0]);
  }
  return {
    ...(ctx.requestedAccountId ? { accountId: ctx.requestedAccountId } : {}),
    ...(pulledSlugs.size > 0 ? { providerSlug: { notIn: [...pulledSlugs] } } : {}),
    ...ctx.dateFilter,
  };
}
