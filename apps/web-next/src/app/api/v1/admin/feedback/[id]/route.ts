/**
 * Admin Feedback Detail API
 * PATCH /api/v1/admin/feedback/[id] - Update feedback status, releaseTag, adminNote
 */

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { validateSession } from '@/lib/api/auth';
import { success, errors, getAuthToken } from '@/lib/api/response';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const token = getAuthToken(request);
    if (!token) return errors.unauthorized('No auth token provided');

    const sessionUser = await validateSession(token);
    if (!sessionUser) return errors.unauthorized('Invalid or expired session');

    if (!sessionUser.roles.includes('system:admin')) {
      return errors.forbidden('Admin permission required');
    }

    const { id } = await params;
    const body = await request.json();
    const { status, releaseTag, adminNote } = body;

    const existing = await prisma.feedback.findUnique({ where: { id } });
    if (!existing) {
      return errors.notFound('Feedback');
    }

    const validStatuses = ['open', 'investigating', 'roadmap', 'released', 'closed'];
    if (status && !validStatuses.includes(status)) {
      return errors.badRequest(
        `Status must be one of: ${validStatuses.join(', ')}`,
      );
    }

    const data: Record<string, unknown> = {};
    if (status !== undefined) data.status = status;
    if (releaseTag !== undefined) data.releaseTag = releaseTag;
    if (adminNote !== undefined) data.adminNote = adminNote;

    const updated = await prisma.feedback.update({
      where: { id },
      data,
    });

    return success({ feedback: updated });
  } catch (err) {
    console.error('Error updating feedback:', err);
    return errors.internal('Failed to update feedback');
  }
}
