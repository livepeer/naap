/**
 * Service Gateway — Admin: Usage by API Key
 * GET /api/v1/gw/admin/usage/by-key
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
  const connectorId = searchParams.get('connectorId');

  const fromDate = from ? new Date(from) : new Date(Date.now() - 24 * 60 * 60 * 1000);
  const toDate = to ? new Date(to) : new Date();

  const timeFilter = {
    gte: isNaN(fromDate.getTime()) ? new Date(Date.now() - 24 * 60 * 60 * 1000) : fromDate,
    lte: isNaN(toDate.getTime()) ? new Date() : toDate,
  };

  const byKey = await prisma.gatewayUsageRecord.groupBy({
    by: ['apiKeyId'],
    where: {
      teamId: ctx.teamId,
      timestamp: timeFilter,
      apiKeyId: { not: null },
      ...(connectorId ? { connectorId } : {}),
    },
    _count: true,
    _avg: { latencyMs: true },
    orderBy: { _count: { apiKeyId: 'desc' } },
  });

  // Enrich with key names and plan info
  const keyIds = byKey.map((k) => k.apiKeyId).filter(Boolean) as string[];
  if (keyIds.length === 0) return success([]);

  const keys = await prisma.gatewayApiKey.findMany({
    where: { id: { in: keyIds } },
    select: {
      id: true,
      name: true,
      keyPrefix: true,
      status: true,
      plan: { select: { id: true, name: true, dailyQuota: true, monthlyQuota: true } },
    },
  });
  const keyMap = new Map(keys.map((k) => [k.id, k]));

  const data = byKey.map((k) => {
    const key = keyMap.get(k.apiKeyId || '');
    return {
      apiKeyId: k.apiKeyId,
      keyName: key?.name || 'Unknown',
      keyPrefix: key?.keyPrefix || '???',
      status: key?.status || 'unknown',
      plan: key?.plan || null,
      requests: k._count,
      avgLatencyMs: Math.round(k._avg.latencyMs || 0),
    };
  });

  return success(data);
}
