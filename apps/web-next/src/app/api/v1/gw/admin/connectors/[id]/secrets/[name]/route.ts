/**
 * Service Gateway — Admin: Delete Connector Secret
 * DELETE /api/v1/gw/admin/connectors/:id/secrets/:name
 *
 * Owner-only: removes a single upstream secret from SecretVault.
 */

import { NextRequest } from 'next/server';
import { success, errors } from '@/lib/api/response';
import { getAdminContext, isErrorResponse, loadOwnedConnector } from '@/lib/gateway/admin/team-guard';
import { prisma } from '@/lib/db';
import { logAudit } from '@/lib/gateway/admin/audit';

type RouteContext = { params: Promise<{ id: string; name: string }> };

const SECRET_KEY_PREFIX = 'gw';

function secretKey(scopeId: string, connectorSlug: string, name: string): string {
  return `${SECRET_KEY_PREFIX}:${scopeId}:${connectorSlug}:${name}`;
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const ctx = await getAdminContext(request);
  if (isErrorResponse(ctx)) return ctx;

  const { id, name } = await context.params;
  const connector = await loadOwnedConnector(id, ctx.teamId);
  if (!connector) {
    return errors.notFound('Connector');
  }

  const secretRefs: string[] = connector.secretRefs || [];
  if (!secretRefs.includes(name)) {
    return errors.notFound('Secret ref');
  }

  const key = secretKey(ctx.teamId, connector.slug, name);
  await prisma.secretVault.deleteMany({ where: { key } });

  logAudit(ctx, { action: 'secret.delete', resourceId: id, details: { ref: name, slug: connector.slug }, request });

  return success({ name, deleted: true });
}
