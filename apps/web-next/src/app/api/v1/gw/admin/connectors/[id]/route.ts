/**
 * Service Gateway — Admin: Connector Detail / Update / Delete
 * GET    /api/v1/gw/admin/connectors/:id
 * PUT    /api/v1/gw/admin/connectors/:id
 * DELETE /api/v1/gw/admin/connectors/:id
 */

export const runtime = 'nodejs';

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { success, errors } from '@/lib/api/response';
import { getAdminContext, isErrorResponse, loadConnectorWithEndpoints, loadOwnedConnector } from '@/lib/gateway/admin/team-guard';
import { updateConnectorSchema } from '@/lib/gateway/admin/validation';
import { invalidateConnectorCache } from '@/lib/gateway/resolve';
import { logAudit } from '@/lib/gateway/admin/audit';

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  const ctx = await getAdminContext(request);
  if (isErrorResponse(ctx)) return ctx;

  const { id } = await context.params;
  const connector = await loadConnectorWithEndpoints(id, ctx.teamId);
  if (!connector) {
    return errors.notFound('Connector');
  }

  return success(connector);
}

export async function PUT(request: NextRequest, context: RouteContext) {
  const ctx = await getAdminContext(request);
  if (isErrorResponse(ctx)) return ctx;

  const { id } = await context.params;
  const existing = await loadOwnedConnector(id, ctx.teamId);
  if (!existing) {
    return errors.notFound('Connector');
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errors.badRequest('Invalid JSON body');
  }

  const parsed = updateConnectorSchema.safeParse(body);
  if (!parsed.success) {
    return errors.validationError(
      Object.fromEntries(
        parsed.error.errors.map((e) => [e.path.join('.'), e.message])
      )
    );
  }

  const connector = await prisma.serviceConnector.update({
    where: { id },
    data: {
      ...parsed.data,
      version: { increment: 1 },
    },
    include: { endpoints: true },
  });

  invalidateConnectorCache(ctx.teamId, connector.slug);

  logAudit(ctx, { action: 'connector.update', resourceId: id, details: { slug: connector.slug }, request });

  return success(connector);
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const ctx = await getAdminContext(request);
  if (isErrorResponse(ctx)) return ctx;

  const { id } = await context.params;
  const existing = await loadOwnedConnector(id, ctx.teamId);
  if (!existing) {
    return errors.notFound('Connector');
  }

  await prisma.serviceConnector.update({
    where: { id },
    data: { status: 'archived' },
  });

  invalidateConnectorCache(ctx.teamId, existing.slug);

  logAudit(ctx, { action: 'connector.delete', resourceId: id, details: { slug: existing.slug }, request });

  return success({ id, status: 'archived' });
}
