/**
 * Service Gateway — Admin: Publish Connector
 * POST /api/v1/gw/admin/connectors/:id/publish
 *
 * Transitions a connector from draft → published.
 * Requires at least one endpoint to be configured.
 */

export const runtime = 'nodejs';

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { success, errors } from '@/lib/api/response';
import { getAdminContext, isErrorResponse, loadConnectorWithEndpoints } from '@/lib/gateway/admin/team-guard';
import { invalidateConnectorCache } from '@/lib/gateway/resolve';

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, context: RouteContext) {
  const ctx = await getAdminContext(request);
  if (isErrorResponse(ctx)) return ctx;

  const { id } = await context.params;
  const connector = await loadConnectorWithEndpoints(id, ctx.teamId);
  if (!connector) {
    return errors.notFound('Connector');
  }

  if (connector.status === 'published') {
    return errors.conflict('Connector is already published');
  }

  if (connector.status === 'archived') {
    return errors.badRequest('Cannot publish an archived connector. Create a new one instead.');
  }

  // Must have at least one enabled endpoint
  const enabledEndpoints = connector.endpoints.filter((ep) => ep.enabled);
  if (enabledEndpoints.length === 0) {
    return errors.badRequest('Connector must have at least one enabled endpoint before publishing');
  }

  const updated = await prisma.serviceConnector.update({
    where: { id, teamId: ctx.teamId },
    data: {
      status: 'published',
      publishedAt: new Date(),
      version: { increment: 1 },
    },
    include: { endpoints: true },
  });

  invalidateConnectorCache(ctx.teamId, updated.slug);

  return success(updated);
}
