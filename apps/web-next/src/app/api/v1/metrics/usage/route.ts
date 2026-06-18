/**
 * Cross-provider usage dashboard BFF (NAAP-2).
 *
 *   GET /api/v1/metrics/usage?from=ISO&to=ISO[&accountId=…]
 *
 * Aggregates ingested BPP ⑥ usage into a spend view keyed by provider (the
 * "provider column"), so the dashboard can compare spend across ANY number of
 * billing providers. Read-only.
 *
 * Auth: a signed-in user (session). Results are scoped to the billing accounts
 * the caller can reach through their team bindings (the NAAP-1 team →
 * `billingAccountRef` linkage). A non-admin caller can NEVER read another
 * account's spend: an `accountId` they cannot reach is rejected, and omitting
 * `accountId` returns only their own accounts. `system:admin` may query any
 * account (matching the app-wide usage precedent in billing/[provider]).
 * Gated behind the `usage_ingest` flag (default OFF) → 404 when OFF.
 */

export const runtime = 'nodejs';

import { NextRequest } from 'next/server';

import { prisma } from '@/lib/db';
import { success, errors, getAuthToken } from '@/lib/api/response';
import { validateSession } from '@/lib/api/auth';
import { isFeatureEnabled } from '@/lib/feature-flags';
import { USAGE_INGEST_FLAG } from '@/lib/metrics/flags';
import { aggregateSpendByProvider } from '@/lib/metrics/aggregate';

const MAX_RECORDS = 50_000;

function parseDate(raw: string | null): Date | null {
  if (!raw) return null;
  const ts = Date.parse(raw);
  return Number.isNaN(ts) ? null : new Date(ts);
}

function isSystemAdmin(roles: string[] | undefined): boolean {
  return Boolean(roles?.includes('system:admin'));
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
  let where: Record<string, unknown>;
  if (isSystemAdmin(user.roles)) {
    where = {
      ...(requestedAccountId ? { accountId: requestedAccountId } : {}),
      ...dateFilter,
    };
  } else {
    const refs = await accessibleBillingAccountRefs(user.id);
    let scoped = refs;
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
    where = {
      OR: scoped.map((r) => ({ providerSlug: r.providerSlug, accountId: r.accountId })),
      ...dateFilter,
    };
  }

  const records = await prisma.providerUsageRecord.findMany({
    where,
    select: {
      providerSlug: true,
      accountId: true,
      appId: true,
      sessions: true,
      tickets: true,
      feeWei: true,
      networkFeeUsdMicros: true,
    },
    take: MAX_RECORDS,
  });

  const providers = aggregateSpendByProvider(records);
  return success({ providers });
}
