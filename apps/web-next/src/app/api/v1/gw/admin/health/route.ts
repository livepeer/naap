/**
 * Service Gateway — Admin: Health Status Overview
 * GET /api/v1/gw/admin/health
 *
 * Returns the latest health status for all published connectors (team-scoped).
 */

export const runtime = 'nodejs';

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { success } from '@/lib/api/response';
import { getAdminContext, isErrorResponse } from '@/lib/gateway/admin/team-guard';

export async function GET(request: NextRequest) {
  const ctx = await getAdminContext(request);
  if (isErrorResponse(ctx)) return ctx;

  // Get all published connectors for this team
  const connectors = await prisma.serviceConnector.findMany({
    where: { teamId: ctx.teamId, status: 'published' },
    select: {
      id: true,
      slug: true,
      displayName: true,
      upstreamBaseUrl: true,
      healthChecks: {
        orderBy: { checkedAt: 'desc' },
        take: 1,
        select: {
          status: true,
          latencyMs: true,
          statusCode: true,
          error: true,
          checkedAt: true,
        },
      },
    },
  });

  const data = connectors.map((c) => {
    const lastCheck = c.healthChecks[0] || null;
    return {
      connectorId: c.id,
      slug: c.slug,
      displayName: c.displayName,
      upstreamBaseUrl: c.upstreamBaseUrl,
      status: lastCheck?.status || 'unknown',
      latencyMs: lastCheck?.latencyMs || null,
      statusCode: lastCheck?.statusCode || null,
      error: lastCheck?.error || null,
      lastCheckedAt: lastCheck?.checkedAt?.toISOString() || null,
    };
  });

  const upCount = data.filter((d) => d.status === 'up').length;
  const downCount = data.filter((d) => d.status === 'down').length;
  const degradedCount = data.filter((d) => d.status === 'degraded').length;

  return success({
    summary: {
      total: data.length,
      up: upCount,
      down: downCount,
      degraded: degradedCount,
      unknown: data.length - upCount - downCount - degradedCount,
    },
    connectors: data,
  });
}
