import type { UsageApiResponse, UsageByUserRow } from '@pymthouse/builder-api';

/** ISO bounds for the current calendar month in UTC (billing-friendly window). */
export function getUtcCalendarMonthIsoBounds(now: Date = new Date()): {
  startDate: string;
  endDate: string;
} {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const start = new Date(Date.UTC(y, m, 1, 0, 0, 0, 0));
  const end = new Date(Date.UTC(y, m + 1, 0, 23, 59, 59, 999));
  return { startDate: start.toISOString(), endDate: end.toISOString() };
}

/**
 * Parse a single date query value. Accepts ISO strings understood by `Date.parse`.
 * Returns `null` when missing, empty, or invalid.
 */
export function parseUsageDateParam(raw: string | null): string | null {
  if (raw == null) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const t = Date.parse(trimmed);
  if (Number.isNaN(t)) return null;
  return trimmed;
}

export function pickByUserRowForExternalId(
  byUser: UsageByUserRow[] | undefined,
  externalUserId: string,
): UsageByUserRow | undefined {
  if (!byUser?.length) return undefined;
  return byUser.find((row) => row.externalUserId === externalUserId);
}

export function buildMeScopeUsagePayload(
  usage: UsageApiResponse,
  externalUserId: string,
): {
  clientId: string;
  period: UsageApiResponse['period'];
  currentUser: {
    externalUserId: string;
    requestCount: number;
    feeWei: string;
  };
} {
  const row = pickByUserRowForExternalId(usage.byUser, externalUserId);
  return {
    clientId: usage.clientId,
    period: usage.period,
    currentUser: {
      externalUserId,
      requestCount: row?.requestCount ?? 0,
      feeWei: row?.feeWei ?? '0',
    },
  };
}

export function isSystemAdmin(roles: string[] | undefined): boolean {
  return Boolean(roles?.includes('system:admin'));
}
