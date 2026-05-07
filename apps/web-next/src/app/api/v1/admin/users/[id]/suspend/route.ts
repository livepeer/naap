/**
 * POST /api/v1/admin/users/[id]/suspend
 * Suspend or activate a user (admin only).
 * Body: { action: 'suspend' | 'activate', reason?: string }
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { validateSession } from '@/lib/api/auth';
import { validateCSRF } from '@/lib/api/csrf';
import { success, errors, getAuthToken } from '@/lib/api/response';

export async function POST(
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

    let body: { action?: unknown; reason?: unknown };
    try {
      body = await request.json();
    } catch {
      return errors.badRequest('Invalid JSON body');
    }

    const action = body?.action;
    const reason = typeof body?.reason === 'string' ? body.reason : undefined;

    if (action !== 'suspend' && action !== 'activate') {
      return errors.badRequest('action must be "suspend" or "activate"');
    }

    if (targetUserId === sessionUser.id) {
      return errors.badRequest(`Cannot ${action} yourself`);
    }

    const targetUser = await prisma.user.findUnique({
      where: { id: targetUserId },
      include: { roles: { include: { role: true } } },
    });

    if (!targetUser) return errors.notFound('User');

    if (targetUser.roles.some(ur => ur.role.name === 'system:root')) {
      return errors.forbidden(`Cannot ${action} system:root user`);
    }

    if (action === 'suspend') {
      const suspendedAt = new Date();
      await prisma.$transaction([
        prisma.user.update({
          where: { id: targetUserId },
          data: {
            suspendedAt,
            suspendedReason: reason || null,
            sessionVersion: { increment: 1 },
          },
        }),
      ]);

      return success({
        id: targetUserId,
        suspended: true,
        suspendedAt: suspendedAt.toISOString(),
        reason: reason || null,
      });
    }

    await prisma.user.update({
      where: { id: targetUserId },
      data: {
        suspendedAt: null,
        suspendedReason: null,
      },
    });

    return success({
      id: targetUserId,
      suspended: false,
    });
  } catch (err) {
    console.error('Error suspending/activating user:', err);
    return errors.internal('Failed to update user status');
  }
}
