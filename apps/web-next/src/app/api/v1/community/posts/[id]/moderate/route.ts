/**
 * Community Post Moderation API Route
 * POST /api/v1/community/posts/:id/moderate - Admin moderation actions
 *
 * Actions: delete, close, archive
 * Requires community:admin or system:admin role.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { validateSession } from '@/lib/api/auth';
import { success, errors, getAuthToken } from '@/lib/api/response';
import { validateCSRF } from '@/lib/api/csrf';

interface RouteParams {
  params: Promise<{ id: string }>;
}

const VALID_ACTIONS = ['delete', 'close', 'archive'] as const;
type ModerateAction = (typeof VALID_ACTIONS)[number];

export async function POST(request: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  try {
    const { id } = await params;

    const token = getAuthToken(request);
    if (!token) {
      return errors.unauthorized('No auth token provided');
    }

    const csrfError = validateCSRF(request, { shadowMode: true });
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

    let body: { action?: unknown };
    try {
      body = await request.json();
    } catch {
      return errors.badRequest('Invalid JSON in request body');
    }
    const action = body.action;

    if (typeof action !== 'string' || !VALID_ACTIONS.includes(action as ModerateAction)) {
      return errors.badRequest(`action must be one of: ${VALID_ACTIONS.join(', ')}`);
    }

    const post = await prisma.communityPost.findUnique({ where: { id } });
    if (!post) {
      return errors.notFound('Post');
    }

    if (action === 'delete') {
      await prisma.communityPost.delete({ where: { id } });
      return success({ deleted: true, postId: id });
    }

    const statusMap = { close: 'CLOSED', archive: 'ARCHIVED' } as const;
    const newStatus = statusMap[action];

    const updated = await prisma.communityPost.update({
      where: { id },
      data: { status: newStatus },
    });

    return success({ post: { id: updated.id, status: updated.status } });
  } catch (err) {
    console.error('Moderate post error:', err);
    return errors.internal('Failed to moderate post');
  }
}
