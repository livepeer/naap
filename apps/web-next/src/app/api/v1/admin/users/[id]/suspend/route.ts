/**
 * POST /api/v1/admin/users/[id]/suspend
 * Suspend or activate a user (admin only).
 * Body: { action: 'suspend' | 'activate', reason?: string }
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { validateSession, revokeAllSessions } from '@/lib/api/auth';
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
    const body = await request.json();
    const { action, reason } = body;

    if (action !== 'suspend' && action !== 'activate') {
      return errors.badRequest('action must be "suspend" or "activate"');
    }

    if (targetUserId === sessionUser.id) {
      return errors.badRequest('Cannot suspend yourself');
    }

    const targetUser = await prisma.user.findUnique({
      where: { id: targetUserId },
      include: { roles: { include: { role: true } } },
    });

    if (!targetUser) return errors.notFound('User');

    if (targetUser.roles.some(ur => ur.role.name === 'system:root')) {
      return errors.forbidden('Cannot suspend system:root user');
    }

    if (action === 'suspend') {
      await prisma.user.update({
        where: { id: targetUserId },
        data: {
          suspendedAt: new Date(),
          suspendedReason: reason || null,
        },
      });

      await revokeAllSessions(targetUserId);

      return success({
        id: targetUserId,
        suspended: true,
        suspendedAt: new Date().toISOString(),
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
