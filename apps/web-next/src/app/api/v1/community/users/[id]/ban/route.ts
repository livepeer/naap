/**
 * Community User Ban API Route
 * POST /api/v1/community/users/:id/ban - Ban or unban a user from the community
 *
 * Requires community:admin or system:admin role.
 * The :id param is the User.id (not CommunityProfile.id).
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { validateSession } from '@/lib/api/auth';
import { success, errors, getAuthToken } from '@/lib/api/response';
import { validateCSRF } from '@/lib/api/csrf';

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function POST(request: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  try {
    const { id: targetUserId } = await params;

    const token = getAuthToken(request);
    if (!token) {
      return errors.unauthorized('No auth token provided');
    }

    const csrfError = validateCSRF(request, token);
    if (csrfError) {
      return csrfError;
    }

    const authUser = await validateSession(token);
    if (!authUser) {
      return errors.unauthorized('Invalid or expired session');
    }

    const isAdmin = authUser.roles.includes('community:admin') || authUser.roles.includes('system:admin');
    if (!isAdmin) {
      return errors.forbidden('Admin permission required');
    }

    if (targetUserId === authUser.id) {
      return errors.badRequest('Cannot ban yourself');
    }

    let body: { banned?: unknown; reason?: unknown };
    try {
      body = await request.json();
    } catch {
      return errors.badRequest('Invalid JSON in request body');
    }
    const { banned, reason } = body;

    if (typeof banned !== 'boolean') {
      return errors.badRequest('banned must be a boolean');
    }

    if (reason != null && typeof reason !== 'string') {
      return errors.badRequest('reason must be a string');
    }

    const profile = await prisma.communityProfile.findUnique({
      where: { userId: targetUserId },
    });

    if (!profile) {
      return errors.notFound('Community profile');
    }

    const updated = await prisma.communityProfile.update({
      where: { userId: targetUserId },
      data: {
        isBanned: banned,
        bannedAt: banned ? new Date() : null,
        bannedReason: banned ? ((reason as string)?.trim() || null) : null,
      },
    });

    return success({
      userId: targetUserId,
      isBanned: updated.isBanned,
      bannedAt: updated.bannedAt?.toISOString() ?? null,
      bannedReason: updated.bannedReason,
    });
  } catch (err) {
    console.error('Ban user error:', err);
    return errors.internal('Failed to update ban status');
  }
}
