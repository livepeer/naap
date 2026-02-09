/**
 * Team API Routes
 * GET /api/v1/teams/:teamId - Get team details
 * PUT /api/v1/teams/:teamId - Update team
 * DELETE /api/v1/teams/:teamId - Delete team
 */

import { NextRequest } from 'next/server';
import { validateSession } from '@/lib/api/auth';
import { getTeam, getTeamMember, updateTeam, deleteTeam } from '@/lib/api/teams';
import { success, errors, getAuthToken } from '@/lib/api/response';
import { validateCSRF } from '@/lib/api/csrf';

interface RouteParams {
  params: Promise<{ teamId: string }>;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { teamId } = await params;

    const token = getAuthToken(request);
    if (!token) {
      return errors.unauthorized('No auth token provided');
    }

    const user = await validateSession(token);
    if (!user) {
      return errors.unauthorized('Invalid or expired session');
    }

    const team = await getTeam(teamId);
    if (!team) {
      return errors.notFound('Team');
    }

    // Check if user is a member
    const member = await getTeamMember(teamId, user.id);
    if (!member) {
      return errors.forbidden('Not a member of this team');
    }

    return success({
      team,
      membership: { role: member.role },
    });
  } catch (err) {
    console.error('Error getting team:', err);
    return errors.internal('Failed to get team');
  }
}

export async function PUT(request: NextRequest, { params }: RouteParams) {
  try {
    const { teamId } = await params;

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
    const { name, description, avatarUrl } = body;

    const team = await updateTeam(
      teamId,
      { name, description, avatarUrl },
      user.id
    );

    return success({ team });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to update team';
    return errors.badRequest(message);
  }
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const { teamId } = await params;

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

    await deleteTeam(teamId, user.id);

    return success({ message: 'Team deleted' });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to delete team';
    return errors.badRequest(message);
  }
}
