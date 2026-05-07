/**
 * PATCH /api/v1/admin/users/[id]/role
 * Change a user's roles (admin only).
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { validateSession } from '@/lib/api/auth';
import { validateCSRF } from '@/lib/api/csrf';
import { success, errors, getAuthToken } from '@/lib/api/response';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const csrfErr = validateCSRF(request, { shadowMode: true });
    if (csrfErr) return csrfErr;

    const token = getAuthToken(request);
    if (!token) return errors.unauthorized('No auth token provided');

    const sessionUser = await validateSession(token);
    if (!sessionUser) return errors.unauthorized('Invalid or expired session');
    if (!sessionUser.roles.includes('system:admin')) {
      return errors.forbidden('Admin permission required');
    }

    const { id: targetUserId } = await params;
    const body = await request.json();
    const { roles: newRoles } = body;

    if (!Array.isArray(newRoles) || newRoles.length === 0) {
      return errors.badRequest('roles must be a non-empty array of role name strings');
    }

    if (targetUserId === sessionUser.id) {
      return errors.badRequest('Cannot change your own roles');
    }

    if (newRoles.includes('system:root')) {
      return errors.forbidden('Cannot assign system:root role via API');
    }

    const targetUser = await prisma.user.findUnique({
      where: { id: targetUserId },
      include: { roles: { include: { role: true } } },
    });

    if (!targetUser) return errors.notFound('User');

    if (targetUser.roles.some(ur => ur.role.name === 'system:root')) {
      return errors.forbidden('Cannot modify roles for system:root user');
    }

    const dbRoles = await prisma.role.findMany({
      where: { name: { in: newRoles } },
    });

    if (dbRoles.length !== newRoles.length) {
      const found = dbRoles.map(r => r.name);
      const missing = newRoles.filter((r: string) => !found.includes(r));
      return errors.badRequest(`Unknown roles: ${missing.join(', ')}`);
    }

    await prisma.$transaction(async (tx) => {
      await tx.userRole.deleteMany({ where: { userId: targetUserId } });
      await tx.userRole.createMany({
        data: dbRoles.map(role => ({
          userId: targetUserId,
          roleId: role.id,
          grantedBy: sessionUser.id,
        })),
      });
    });

    const updated = await prisma.user.findUnique({
      where: { id: targetUserId },
      include: { roles: { include: { role: true } } },
    });

    return success({
      id: targetUserId,
      roles: updated?.roles.map(ur => ur.role.name) ?? [],
    });
  } catch (err) {
    console.error('Error changing user roles:', err);
    return errors.internal('Failed to change user roles');
  }
}
