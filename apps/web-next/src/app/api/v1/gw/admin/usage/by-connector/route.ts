/**
 * Service Gateway — Admin: Usage by Connector
 * GET /api/v1/gw/admin/usage/by-connector
 */

export const runtime = 'nodejs';

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { success } from '@/lib/api/response';
import { getAdminContext, isErrorResponse } from '@/lib/gateway/admin/team-guard';

export async function GET(request: NextRequest) {
  const ctx = await getAdminContext(request);
  if (isErrorResponse(ctx)) return ctx;

  const { searchParams } = request.nextUrl;
  const from = searchParams.get('from');
  const to = searchParams.get('to');

  const timeFilter = {
    ...(from ? { gte: new Date(from) } : { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }),
    ...(to ? { lte: new Date(to) } : {}),
  };

  const byConnector = await prisma.gatewayUsageRecord.groupBy({
    by: ['connectorId'],
    where: {
      teamId: ctx.teamId,
      timestamp: timeFilter,
    },
    _count: true,
    _avg: { latencyMs: true, upstreamLatencyMs: true },
    _sum: { requestBytes: true, responseBytes: true },
    orderBy: { _count: { connectorId: 'desc' } },
  });

  // Get error counts per connector
  const errorsByConnector = await prisma.gatewayUsageRecord.groupBy({
    by: ['connectorId'],
    where: {
      teamId: ctx.teamId,
      timestamp: timeFilter,
      statusCode: { gte: 400 },
    },
    _count: true,
  });

  const errorMap = new Map(errorsByConnector.map((e) => [e.connectorId, e._count]));

  // Enrich with connector names
  const connectorIds = byConnector.map((c) => c.connectorId);
  const connectors = await prisma.serviceConnector.findMany({
    where: { id: { in: connectorIds }, teamId: ctx.teamId },
    select: { id: true, slug: true, displayName: true },
  });
  const connectorMap = new Map(connectors.map((c) => [c.id, c]));

  const data = byConnector.map((c) => ({
    connectorId: c.connectorId,
    slug: connectorMap.get(c.connectorId)?.slug || 'unknown',
    displayName: connectorMap.get(c.connectorId)?.displayName || 'Unknown',
    requests: c._count,
    avgLatencyMs: Math.round(c._avg.latencyMs || 0),
    avgUpstreamLatencyMs: Math.round(c._avg.upstreamLatencyMs || 0),
    errorCount: errorMap.get(c.connectorId) || 0,
    errorRate: c._count > 0
      ? Number((((errorMap.get(c.connectorId) || 0) / c._count) * 100).toFixed(2))
      : 0,
    totalRequestBytes: c._sum.requestBytes || 0,
    totalResponseBytes: c._sum.responseBytes || 0,
  }));

  return success(data);
}
