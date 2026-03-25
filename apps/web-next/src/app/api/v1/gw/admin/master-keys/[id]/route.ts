/**
 * Service Gateway — Admin: Master Key Detail / Revoke
 * GET    /api/v1/gw/admin/master-keys/:id   — Get key details
 * DELETE /api/v1/gw/admin/master-keys/:id   — Revoke key
 */

export const runtime = 'nodejs';

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { success, errors } from '@/lib/api/response';
import { getAdminContext, isErrorResponse } from '@/lib/gateway/admin/team-guard';
import { logAudit } from '@/lib/gateway/admin/audit';

type RouteContext = { params: Promise<{ id: string }> };

function ownerWhere(ctx: { teamId: string; userId: string; isPersonal: boolean }) {
  if (ctx.isPersonal) return { ownerUserId: ctx.userId };
  return { teamId: ctx.teamId };
}

export async function GET(request: NextRequest, context: RouteContext) {
  const ctx = await getAdminContext(request);
  if (isErrorResponse(ctx)) return ctx;

  const { id } = await context.params;
  const masterKey = await prisma.gatewayMasterKey.findFirst({
    where: { id, ...ownerWhere(ctx) },
  });

  if (!masterKey) {
    return errors.notFound('Master Key');
  }

  const { keyHash, ...safeKey } = masterKey;
  return success(safeKey);
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const ctx = await getAdminContext(request);
  if (isErrorResponse(ctx)) return ctx;

  const { id } = await context.params;
  const masterKey = await prisma.gatewayMasterKey.findFirst({
    where: { id, ...ownerWhere(ctx) },
  });

  if (!masterKey) {
    return errors.notFound('Master Key');
  }

  const revoked = await prisma.gatewayMasterKey.updateMany({
    where: { id, ...ownerWhere(ctx), status: { not: 'revoked' } },
    data: { status: 'revoked', revokedAt: new Date() },
  });

  if (revoked.count === 0) {
    return errors.conflict('Master key is already revoked');
  }

  await logAudit(ctx, {
    action: 'master-key.revoke',
    resourceId: id,
    details: { name: masterKey.name },
    request,
  });

  return success({ id, status: 'revoked' });
}
