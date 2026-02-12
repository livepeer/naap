/**
 * Service Gateway — Admin: Usage Timeseries
 * GET /api/v1/gw/admin/usage/timeseries
 *
 * Returns time-bucketed request counts for charting.
 * Query params: from, to, interval (1m, 5m, 1h, 1d), connectorId
 */

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { success } from '@/lib/api/response';
import { getAdminContext, isErrorResponse } from '@/lib/gateway/admin/team-guard';

const INTERVAL_MS: Record<string, number> = {
  '1m': 60_000,
  '5m': 300_000,
  '15m': 900_000,
  '1h': 3_600_000,
  '6h': 21_600_000,
  '1d': 86_400_000,
};

export async function GET(request: NextRequest) {
  const ctx = await getAdminContext(request);
  if (isErrorResponse(ctx)) return ctx;

  const { searchParams } = request.nextUrl;
  const from = searchParams.get('from');
  const to = searchParams.get('to');
  const interval = searchParams.get('interval') || '5m';
  const connectorId = searchParams.get('connectorId');

  const intervalMs = INTERVAL_MS[interval] || INTERVAL_MS['5m'];
  const fromDate = from ? new Date(from) : new Date(Date.now() - 60 * 60 * 1000);
  const toDate = to ? new Date(to) : new Date();

  const records = await prisma.gatewayUsageRecord.findMany({
    where: {
      teamId: ctx.teamId,
      timestamp: { gte: fromDate, lte: toDate },
      ...(connectorId ? { connectorId } : {}),
    },
    select: {
      timestamp: true,
      statusCode: true,
      latencyMs: true,
    },
    orderBy: { timestamp: 'asc' },
  });

  // Bucket records by interval
  const buckets = new Map<number, { requests: number; errors: number; totalLatency: number }>();

  for (const record of records) {
    const bucketTs = Math.floor(record.timestamp.getTime() / intervalMs) * intervalMs;
    const bucket = buckets.get(bucketTs) || { requests: 0, errors: 0, totalLatency: 0 };
    bucket.requests++;
    bucket.totalLatency += record.latencyMs;
    if (record.statusCode >= 400) bucket.errors++;
    buckets.set(bucketTs, bucket);
  }

  // Fill empty buckets
  const data: Array<{
    timestamp: string;
    requests: number;
    errors: number;
    errorRate: number;
    avgLatencyMs: number;
  }> = [];

  let current = Math.floor(fromDate.getTime() / intervalMs) * intervalMs;
  while (current <= toDate.getTime()) {
    const bucket = buckets.get(current);
    data.push({
      timestamp: new Date(current).toISOString(),
      requests: bucket?.requests || 0,
      errors: bucket?.errors || 0,
      errorRate: bucket && bucket.requests > 0
        ? Number(((bucket.errors / bucket.requests) * 100).toFixed(2))
        : 0,
      avgLatencyMs: bucket && bucket.requests > 0
        ? Math.round(bucket.totalLatency / bucket.requests)
        : 0,
    });
    current += intervalMs;
  }

  return success({
    interval,
    from: fromDate.toISOString(),
    to: toDate.toISOString(),
    points: data,
  });
}
