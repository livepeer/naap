/**
 * Cross-provider usage dashboard BFF (NAAP-2).
 *
 *   GET /api/v1/metrics/usage?from=ISO&to=ISO[&accountId=…]
 *
 * Aggregates ingested BPP ⑥ usage into a spend view keyed by provider (the
 * "provider column"), so the dashboard can compare spend across ANY number of
 * billing providers. Read-only.
 *
 * Auth: a signed-in user (session). Gated behind the `usage_ingest` flag
 * (default OFF) → 404 when OFF.
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
  const accountId = sp.get('accountId')?.trim() || undefined;

  const where = {
    ...(accountId ? { accountId } : {}),
    ...(from || to
      ? { windowTo: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } }
      : {}),
  };

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
