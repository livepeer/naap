/**
 * Team Member API Routes
 * PUT /api/v1/teams/:teamId/members/:memberId - Update member role
 * DELETE /api/v1/teams/:teamId/members/:memberId - Remove member
 */

import { NextRequest } from 'next/server';
import { validateSession } from '@/lib/api/auth';
import { updateMemberRole, removeMember, TeamRole } from '@/lib/api/teams';
import { success, errors, getAuthToken } from '@/lib/api/response';
import { validateCSRF } from '@/lib/api/csrf';

interface RouteParams {
  params: Promise<{ teamId: string; memberId: string }>;
}

export async function PUT(request: NextRequest, { params }: RouteParams) {
  try {
    const { memberId } = await params;

    const token = getAuthToken(request);
    if (!token) {
      return errors.unauthorized('No auth token provided');
    }

    // Validate CSRF token
    const csrfError = validateCSRF(request, token);
    if (csrfError) {
      return csrfError;
    }

    const user = await validateSession(token);
    if (!user) {
      return errors.unauthorized('Invalid or expired session');
    }

    const body = await request.json();
    const { role } = body;

    // Validate role
    const validRoles: TeamRole[] = ['admin', 'member', 'viewer'];
    if (!validRoles.includes(role as TeamRole)) {
      return errors.badRequest('Invalid role. Must be admin, member, or viewer.');
    }

    const member = await updateMemberRole(memberId, role as TeamRole, user.id);

    return success({ member });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to update member';
    return errors.badRequest(message);
  }
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const { memberId } = await params;

    const token = getAuthToken(request);
    if (!token) {
      return errors.unauthorized('No auth token provided');
    }

    // Validate CSRF token
    const csrfError = validateCSRF(request, token);
    if (csrfError) {
      return csrfError;
    }

    const user = await validateSession(token);
    if (!user) {
      return errors.unauthorized('Invalid or expired session');
    }

    await removeMember(memberId, user.id);

    return success({ message: 'Member removed' });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to remove member';
    return errors.badRequest(message);
  }
}
