import {
  type UsageApiResponse,
} from '@pymthouse/builder-api';

export interface UsageByPipelineModelFiatRow {
  pipeline: string;
  modelId: string;
  requestCount: number;
  currency: string;
  networkFeeUsdMicros: string;
  ownerChargeUsdMicros: string;
  endUserBillableUsdMicros: string;
}

interface UsageByUserFiatSummary {
  externalUserId: string;
  requestCount: number;
  currency: string;
  networkFeeUsdMicros: string;
  ownerChargeUsdMicros: string;
  endUserBillableUsdMicros: string;
}

function parseSafeBigInt(value: string | number | bigint, fallback = 0n): bigint {
  try {
    return BigInt(value);
  } catch {
    return fallback;
  }
}

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

export function getUsageRecordUserIdsForExternalUser(
  usage: UsageApiResponse,
  externalUserId: string,
): string[] {
  const userIds = new Set<string>();
  for (const row of usage.byUser ?? []) {
    if (row.externalUserId === externalUserId && row.endUserId !== 'unknown') {
      userIds.add(row.endUserId);
    }
  }
  return [...userIds];
}

function combinePipelineModels(
  usagePipelineModels: UsageApiResponse | UsageApiResponse[] | undefined,
): UsageByPipelineModelFiatRow[] {
  const responses = Array.isArray(usagePipelineModels)
    ? usagePipelineModels
    : usagePipelineModels
      ? [usagePipelineModels]
      : [];
  const byKey = new Map<string, UsageByPipelineModelFiatRow>();

  for (const response of responses) {
    const rows = Array.isArray((response as { byPipelineModel?: unknown }).byPipelineModel)
      ? ((response as { byPipelineModel: unknown[] }).byPipelineModel as Array<Record<string, unknown>>)
      : [];
    for (const row of rows) {
      const pipeline = typeof row.pipeline === 'string' ? row.pipeline : '';
      const modelId = typeof row.modelId === 'string' ? row.modelId : '';
      if (!pipeline || !modelId) continue;
      const key = JSON.stringify([pipeline, modelId]);
      const existing = byKey.get(key);
      const rowRequestCount = Number(row.requestCount ?? 0);
      const rowCurrency = typeof row.currency === 'string' ? row.currency : 'USD';
      const rowNetworkFeeUsdMicros =
        typeof row.networkFeeUsdMicros === 'string' ? row.networkFeeUsdMicros : '0';
      const rowOwnerChargeUsdMicros =
        typeof row.ownerChargeUsdMicros === 'string' ? row.ownerChargeUsdMicros : '0';
      const rowEndUserBillableUsdMicros =
        typeof row.endUserBillableUsdMicros === 'string' ? row.endUserBillableUsdMicros : '0';

      if (!existing) {
        byKey.set(key, {
          pipeline,
          modelId,
          requestCount: Number.isFinite(rowRequestCount) ? rowRequestCount : 0,
          currency: rowCurrency,
          networkFeeUsdMicros: rowNetworkFeeUsdMicros,
          ownerChargeUsdMicros: rowOwnerChargeUsdMicros,
          endUserBillableUsdMicros: rowEndUserBillableUsdMicros,
        });
        continue;
      }
      byKey.set(key, {
        ...existing,
        requestCount: existing.requestCount + (Number.isFinite(rowRequestCount) ? rowRequestCount : 0),
        networkFeeUsdMicros: (
          parseSafeBigInt(existing.networkFeeUsdMicros) + parseSafeBigInt(rowNetworkFeeUsdMicros)
        ).toString(),
        ownerChargeUsdMicros: (
          parseSafeBigInt(existing.ownerChargeUsdMicros) + parseSafeBigInt(rowOwnerChargeUsdMicros)
        ).toString(),
        endUserBillableUsdMicros: (
          parseSafeBigInt(existing.endUserBillableUsdMicros) + parseSafeBigInt(rowEndUserBillableUsdMicros)
        ).toString(),
      });
    }
  }

  return [...byKey.values()].sort((a, b) => {
    if (a.pipeline === b.pipeline) return a.modelId.localeCompare(b.modelId);
    return a.pipeline.localeCompare(b.pipeline);
  });
}

function summarizeUsageForExternalUserFiat(
  usageByUser: UsageApiResponse,
  externalUserId: string,
): UsageByUserFiatSummary {
  const rows = Array.isArray((usageByUser as { byUser?: unknown }).byUser)
    ? ((usageByUser as { byUser: unknown[] }).byUser as Array<Record<string, unknown>>)
    : [];
  let requestCount = 0;
  let networkFeeUsdMicros = 0n;
  let ownerChargeUsdMicros = 0n;
  let endUserBillableUsdMicros = 0n;
  let currency = 'USD';

  for (const row of rows) {
    if (row.externalUserId !== externalUserId) continue;
    const rowCount = Number(row.requestCount ?? 0);
    requestCount += Number.isFinite(rowCount) ? rowCount : 0;
    const rowCurrency = typeof row.currency === 'string' ? row.currency : null;
    if (rowCurrency) currency = rowCurrency;
    if (typeof row.networkFeeUsdMicros === 'string') {
      networkFeeUsdMicros += BigInt(row.networkFeeUsdMicros);
    }
    if (typeof row.ownerChargeUsdMicros === 'string') {
      ownerChargeUsdMicros += BigInt(row.ownerChargeUsdMicros);
    }
    if (typeof row.endUserBillableUsdMicros === 'string') {
      endUserBillableUsdMicros += BigInt(row.endUserBillableUsdMicros);
    }
  }

  return {
    externalUserId,
    requestCount,
    currency,
    networkFeeUsdMicros: networkFeeUsdMicros.toString(),
    ownerChargeUsdMicros: ownerChargeUsdMicros.toString(),
    endUserBillableUsdMicros: endUserBillableUsdMicros.toString(),
  };
}

export function buildMeScopeUsagePayload(
  usageByUser: UsageApiResponse,
  externalUserId: string,
  usagePipelineModel?: UsageApiResponse | UsageApiResponse[],
): {
  clientId: string;
  period: UsageApiResponse['period'];
  currentUser: {
    externalUserId: string;
    requestCount: number;
    currency: string;
    networkFeeUsdMicros: string;
    ownerChargeUsdMicros: string;
    endUserBillableUsdMicros: string;
    pipelineModels: UsageByPipelineModelFiatRow[];
  };
} {
  const summary = summarizeUsageForExternalUserFiat(usageByUser, externalUserId);
  const pipelineModels = combinePipelineModels(usagePipelineModel);
  return {
    clientId: usageByUser.clientId,
    period: usageByUser.period,
    currentUser: {
      externalUserId: summary.externalUserId,
      requestCount: summary.requestCount,
      currency: summary.currency,
      networkFeeUsdMicros: summary.networkFeeUsdMicros,
      ownerChargeUsdMicros: summary.ownerChargeUsdMicros,
      endUserBillableUsdMicros: summary.endUserBillableUsdMicros,
      pipelineModels,
    },
  };
}

export function isSystemAdmin(roles: string[] | undefined): boolean {
  return Boolean(roles?.includes('system:admin'));
}
