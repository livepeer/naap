/**
 * Service Gateway — Admin: Endpoint Detail / Update / Delete
 * GET    /api/v1/gw/admin/connectors/:id/endpoints/:endpointId
 * PUT    /api/v1/gw/admin/connectors/:id/endpoints/:endpointId
 * DELETE /api/v1/gw/admin/connectors/:id/endpoints/:endpointId
 */

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { success, errors } from '@/lib/api/response';
import { getAdminContext, isErrorResponse, loadConnector, loadOwnedConnector } from '@/lib/gateway/admin/team-guard';
import { updateEndpointSchema } from '@/lib/gateway/admin/validation';
import { invalidateConnectorCache } from '@/lib/gateway/resolve';

type RouteContext = { params: Promise<{ id: string; endpointId: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  const ctx = await getAdminContext(request);
  if (isErrorResponse(ctx)) return ctx;

  const { id, endpointId } = await context.params;
  const connector = await loadConnector(id, ctx.teamId);
  if (!connector) {
    return errors.notFound('Connector');
  }

  const endpoint = await prisma.connectorEndpoint.findFirst({
    where: { id: endpointId, connectorId: id },
  });
  if (!endpoint) {
    return errors.notFound('Endpoint');
  }

  return success(endpoint);
}

export async function PUT(request: NextRequest, context: RouteContext) {
  const ctx = await getAdminContext(request);
  if (isErrorResponse(ctx)) return ctx;

  const { id, endpointId } = await context.params;
  const connector = await loadOwnedConnector(id, ctx.teamId);
  if (!connector) {
    return errors.notFound('Connector');
  }

  const existing = await prisma.connectorEndpoint.findFirst({
    where: { id: endpointId, connectorId: id },
  });
  if (!existing) {
    return errors.notFound('Endpoint');
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errors.badRequest('Invalid JSON body');
  }

  const parsed = updateEndpointSchema.safeParse(body);
  if (!parsed.success) {
    return errors.validationError(
      Object.fromEntries(
        parsed.error.errors.map((e) => [e.path.join('.'), e.message])
      )
    );
  }

  const endpoint = await prisma.connectorEndpoint.update({
    where: { id: endpointId },
    data: parsed.data,
  });

  invalidateConnectorCache(ctx.teamId, connector.slug);

  return success(endpoint);
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const ctx = await getAdminContext(request);
  if (isErrorResponse(ctx)) return ctx;

  const { id, endpointId } = await context.params;
  const connector = await loadOwnedConnector(id, ctx.teamId);
  if (!connector) {
    return errors.notFound('Connector');
  }

  const existing = await prisma.connectorEndpoint.findFirst({
    where: { id: endpointId, connectorId: id },
  });
  if (!existing) {
    return errors.notFound('Endpoint');
  }

  await prisma.connectorEndpoint.delete({
    where: { id: endpointId },
  });

  invalidateConnectorCache(ctx.teamId, connector.slug);

  return success({ id: endpointId, deleted: true });
}
