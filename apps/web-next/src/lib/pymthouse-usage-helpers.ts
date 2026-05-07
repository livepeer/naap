import {
  listUsageByPipelineModel,
  summarizeUsageForExternalUser,
  type UsageApiResponse,
  type UsageByPipelineModelRow,
} from '@pymthouse/builder-api';

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
): UsageByPipelineModelRow[] {
  const responses = Array.isArray(usagePipelineModels)
    ? usagePipelineModels
    : usagePipelineModels
      ? [usagePipelineModels]
      : [];
  const byKey = new Map<string, UsageByPipelineModelRow>();

  for (const response of responses) {
    for (const row of listUsageByPipelineModel(response)) {
      const key = `${row.pipeline}:${row.modelId}`;
      const existing = byKey.get(key);
      if (!existing) {
        byKey.set(key, { ...row });
        continue;
      }
      byKey.set(key, {
        ...existing,
        requestCount: existing.requestCount + row.requestCount,
        networkFeeWei: (BigInt(existing.networkFeeWei) + BigInt(row.networkFeeWei)).toString(),
        networkFeeUsdMicros: (
          BigInt(existing.networkFeeUsdMicros) + BigInt(row.networkFeeUsdMicros)
        ).toString(),
        ownerChargeUsdMicros: (
          BigInt(existing.ownerChargeUsdMicros) + BigInt(row.ownerChargeUsdMicros)
        ).toString(),
        endUserBillableUsdMicros: (
          BigInt(existing.endUserBillableUsdMicros) + BigInt(row.endUserBillableUsdMicros)
        ).toString(),
      });
    }
  }

  return listUsageByPipelineModel({
    clientId: '',
    period: { start: null, end: null },
    totals: { requestCount: 0, totalFeeWei: '0' },
    byPipelineModel: [...byKey.values()],
  });
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
    feeWei: string;
    pipelineModels: UsageByPipelineModelRow[];
  };
} {
  const summary = summarizeUsageForExternalUser(usageByUser, externalUserId);
  const pipelineModels = combinePipelineModels(usagePipelineModel);
  return {
    clientId: usageByUser.clientId,
    period: usageByUser.period,
    currentUser: {
      externalUserId: summary.externalUserId,
      requestCount: summary.requestCount,
      feeWei: summary.feeWei,
      pipelineModels,
    },
  };
}

export function isSystemAdmin(roles: string[] | undefined): boolean {
  return Boolean(roles?.includes('system:admin'));
}
