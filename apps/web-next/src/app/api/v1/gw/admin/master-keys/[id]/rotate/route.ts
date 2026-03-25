/**
 * Service Gateway — Admin: Rotate Master Key
 * POST /api/v1/gw/admin/master-keys/:id/rotate
 *
 * Generates a new key, revokes the old one. Returns new raw key ONCE.
 * Atomic: new key is valid before old key is revoked.
 */

export const runtime = 'nodejs';

import { randomBytes, createHash } from 'crypto';
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

export async function POST(request: NextRequest, context: RouteContext) {
  const ctx = await getAdminContext(request);
  if (isErrorResponse(ctx)) return ctx;

  const { id } = await context.params;
  const ownerFilter = ownerWhere(ctx);

  const oldKey = await prisma.gatewayMasterKey.findFirst({
    where: { id, ...ownerFilter },
  });

  if (!oldKey) {
    return errors.notFound('Master Key');
  }

  if (oldKey.status === 'revoked') {
    return errors.badRequest('Cannot rotate a revoked key');
  }

  const rawKey = `gwm_${randomBytes(32).toString('hex')}`;
  const keyHash = createHash('sha256').update(rawKey).digest('hex');
  const keyPrefix = rawKey.slice(0, 12);

  const newKey = await prisma.$transaction(async (tx) => {
    const created = await tx.gatewayMasterKey.create({
      data: {
        ...ownerFilter,
        createdBy: ctx.userId,
        name: `${oldKey.name} (rotated)`,
        keyHash,
        keyPrefix,
        scopes: oldKey.scopes,
        allowedIPs: oldKey.allowedIPs,
        expiresAt: oldKey.expiresAt,
      },
    });

    const revoked = await tx.gatewayMasterKey.updateMany({
      where: { id, ...ownerFilter, status: { not: 'revoked' } },
      data: { status: 'revoked', revokedAt: new Date() },
    });

    if (revoked.count !== 1) {
      throw new Error('Master key already rotated or revoked');
    }

    return created;
  });

  await logAudit(ctx, {
    action: 'master-key.rotate',
    resourceId: newKey.id,
    details: { rotatedFrom: id, name: oldKey.name },
    request,
  });

  const { keyHash: _, ...safeKey } = newKey;
  return success({
    ...safeKey,
    rawKey,
    rotatedFrom: id,
  });
}
