/**
 * Service Gateway — Admin: Connector Health History
 * GET /api/v1/gw/admin/health/:id
 *
 * Returns health check history for a specific connector.
 */

export const runtime = 'nodejs';

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { success, errors } from '@/lib/api/response';
import { getAdminContext, isErrorResponse, loadConnector } from '@/lib/gateway/admin/team-guard';

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  const ctx = await getAdminContext(request);
  if (isErrorResponse(ctx)) return ctx;

  const { id } = await context.params;
  const connector = await loadConnector(id, ctx.teamId);
  if (!connector) {
    return errors.notFound('Connector');
  }

  const { searchParams } = request.nextUrl;
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '50', 10)));

  const checks = await prisma.gatewayHealthCheck.findMany({
    where: { connectorId: id },
    orderBy: { checkedAt: 'desc' },
    take: limit,
  });

  return success({
    connectorId: id,
    slug: connector.slug,
    displayName: connector.displayName,
    checks,
  });
}
