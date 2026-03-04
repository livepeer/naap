/**
 * Service Gateway — Admin: Rotate API Key
 * POST /api/v1/gw/admin/keys/:id/rotate
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

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, context: RouteContext) {
  const ctx = await getAdminContext(request);
  if (isErrorResponse(ctx)) return ctx;

  const { id } = await context.params;
  const ownerFilter = ctx.isPersonal
    ? { ownerUserId: ctx.userId }
    : { teamId: ctx.teamId };

  const oldKey = await prisma.gatewayApiKey.findFirst({
    where: { id, ...ownerFilter },
  });

  if (!oldKey) {
    return errors.notFound('API Key');
  }

  if (oldKey.status === 'revoked') {
    return errors.badRequest('Cannot rotate a revoked key');
  }

  // Generate new key
  const rawKey = `gw_${randomBytes(32).toString('hex')}`;
  const keyHash = createHash('sha256').update(rawKey).digest('hex');
  const keyPrefix = rawKey.slice(0, 11);

  const newKey = await prisma.$transaction(async (tx) => {
    const created = await tx.gatewayApiKey.create({
      data: {
        ...ownerFilter,
        createdBy: ctx.userId,
        name: `${oldKey.name} (rotated)`,
        keyHash,
        keyPrefix,
        connectorId: oldKey.connectorId,
        planId: oldKey.planId,
        allowedEndpoints: oldKey.allowedEndpoints,
        allowedIPs: oldKey.allowedIPs,
        expiresAt: oldKey.expiresAt,
      },
      include: {
        connector: { select: { id: true, slug: true, displayName: true } },
        plan: { select: { id: true, name: true, displayName: true } },
      },
    });

    const revoked = await tx.gatewayApiKey.updateMany({
      where: { id, teamId: ctx.teamId, status: { not: 'revoked' } },
      data: { status: 'revoked', revokedAt: new Date() },
    });

    if (revoked.count !== 1) {
      throw new Error('API key already rotated or revoked');
    }

    return created;
  });

  const { keyHash: _, ...safeKey } = newKey;
  return success({
    ...safeKey,
    rawKey, // ⚠️ Only returned on creation
    rotatedFrom: id,
  });
}
