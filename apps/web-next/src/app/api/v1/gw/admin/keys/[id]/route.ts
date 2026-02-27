/**
 * Service Gateway — Admin: API Key Detail / Revoke
 * GET    /api/v1/gw/admin/keys/:id   — Get key details
 * DELETE /api/v1/gw/admin/keys/:id   — Revoke key
 */

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
  const apiKey = await prisma.gatewayApiKey.findFirst({
    where: { id, ...ownerWhere(ctx) },
    include: {
      connector: { select: { id: true, slug: true, displayName: true } },
      plan: { select: { id: true, name: true, displayName: true } },
    },
  });

  if (!apiKey) {
    return errors.notFound('API Key');
  }

  const { keyHash, ...safeKey } = apiKey;
  return success(safeKey);
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const ctx = await getAdminContext(request);
  if (isErrorResponse(ctx)) return ctx;

  const { id } = await context.params;
  const apiKey = await prisma.gatewayApiKey.findFirst({
    where: { id, ...ownerWhere(ctx) },
  });

  if (!apiKey) {
    return errors.notFound('API Key');
  }

  if (apiKey.status === 'revoked') {
    return errors.conflict('API key is already revoked');
  }

  await prisma.gatewayApiKey.update({
    where: { id },
    data: { status: 'revoked', revokedAt: new Date() },
  });

  logAudit(ctx, { action: 'key.revoke', resourceId: id, details: { name: apiKey.name }, request });

  return success({ id, status: 'revoked' });
}
