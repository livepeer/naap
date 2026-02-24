/**
 * Service Gateway — Admin: Endpoint List / Create
 * GET  /api/v1/gw/admin/connectors/:id/endpoints
 * POST /api/v1/gw/admin/connectors/:id/endpoints
 */

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { success, errors } from '@/lib/api/response';
import { getAdminContext, isErrorResponse, loadConnector, loadOwnedConnector } from '@/lib/gateway/admin/team-guard';
import { createEndpointSchema } from '@/lib/gateway/admin/validation';
import { invalidateConnectorCache } from '@/lib/gateway/resolve';

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  const ctx = await getAdminContext(request);
  if (isErrorResponse(ctx)) return ctx;

  const { id } = await context.params;
  const connector = await loadConnector(id, ctx.teamId);
  if (!connector) {
    return errors.notFound('Connector');
  }

  const endpoints = await prisma.connectorEndpoint.findMany({
    where: { connectorId: id },
    orderBy: { createdAt: 'asc' },
  });

  return success(endpoints);
}

export async function POST(request: NextRequest, context: RouteContext) {
  const ctx = await getAdminContext(request);
  if (isErrorResponse(ctx)) return ctx;

  const { id } = await context.params;
  const connector = await loadOwnedConnector(id, ctx.teamId);
  if (!connector) {
    return errors.notFound('Connector');
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errors.badRequest('Invalid JSON body');
  }

  const parsed = createEndpointSchema.safeParse(body);
  if (!parsed.success) {
    return errors.validationError(
      Object.fromEntries(
        parsed.error.errors.map((e) => [e.path.join('.'), e.message])
      )
    );
  }

  // Check for duplicate method+path within connector
  const existing = await prisma.connectorEndpoint.findFirst({
    where: {
      connectorId: id,
      method: parsed.data.method,
      path: parsed.data.path,
    },
  });
  if (existing) {
    return errors.conflict(
      `Endpoint ${parsed.data.method} ${parsed.data.path} already exists on this connector`
    );
  }

  const endpoint = await prisma.connectorEndpoint.create({
    data: {
      connectorId: id,
      ...parsed.data,
    },
  });

  invalidateConnectorCache(ctx.teamId, connector.slug);

  return success(endpoint);
}
