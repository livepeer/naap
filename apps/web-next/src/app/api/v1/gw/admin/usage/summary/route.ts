/**
 * Service Gateway — Admin: Usage Summary
 * GET /api/v1/gw/admin/usage/summary
 *
 * Returns aggregate usage stats: total requests, avg latency, error rate, top connectors.
 * Query params: from, to (ISO timestamps), connectorId (optional filter)
 */

export const runtime = 'nodejs';

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { success, errors } from '@/lib/api/response';
import { getAdminContext, isErrorResponse } from '@/lib/gateway/admin/team-guard';

export async function GET(request: NextRequest) {
  const ctx = await getAdminContext(request);
  if (isErrorResponse(ctx)) return ctx;

  const { searchParams } = request.nextUrl;
  const from = searchParams.get('from');
  const to = searchParams.get('to');
  const connectorId = searchParams.get('connectorId');

  const timeFilter = {
    ...(from ? { gte: new Date(from) } : { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }),
    ...(to ? { lte: new Date(to) } : {}),
  };

  const where = {
    teamId: ctx.teamId,
    timestamp: timeFilter,
    ...(connectorId ? { connectorId } : {}),
  };

  const [aggregate, errorCount, total] = await Promise.all([
    prisma.gatewayUsageRecord.aggregate({
      where,
      _avg: { latencyMs: true, upstreamLatencyMs: true },
      _sum: { requestBytes: true, responseBytes: true },
      _count: true,
    }),
    prisma.gatewayUsageRecord.count({
      where: { ...where, statusCode: { gte: 400 } },
    }),
    prisma.gatewayUsageRecord.count({ where }),
  ]);

  // Top connectors by request count
  const topConnectors = await prisma.gatewayUsageRecord.groupBy({
    by: ['connectorId'],
    where,
    _count: true,
    _avg: { latencyMs: true },
    orderBy: { _count: { connectorId: 'desc' } },
    take: 10,
  });

  return success({
    totalRequests: total,
    avgLatencyMs: Math.round(aggregate._avg.latencyMs || 0),
    avgUpstreamLatencyMs: Math.round(aggregate._avg.upstreamLatencyMs || 0),
    errorCount,
    errorRate: total > 0 ? Number(((errorCount / total) * 100).toFixed(2)) : 0,
    totalRequestBytes: aggregate._sum.requestBytes || 0,
    totalResponseBytes: aggregate._sum.responseBytes || 0,
    topConnectors: topConnectors.map((tc) => ({
      connectorId: tc.connectorId,
      requests: tc._count,
      avgLatencyMs: Math.round(tc._avg.latencyMs || 0),
    })),
    timeRange: {
      from: timeFilter.gte?.toISOString(),
      to: timeFilter.lte?.toISOString() || new Date().toISOString(),
    },
  });
}
