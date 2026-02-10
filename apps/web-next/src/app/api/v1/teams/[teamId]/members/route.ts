/**
 * Team Members API Routes
 * GET /api/v1/teams/:teamId/members - List team members
 * POST /api/v1/teams/:teamId/members - Invite member
 */

import {NextRequest, NextResponse } from 'next/server';
import { validateSession } from '@/lib/api/auth';
import {
  validateTeamAccess,
  listMembers,
  inviteMember,
  TeamRole,
} from '@/lib/api/teams';
import { success, errors, getAuthToken } from '@/lib/api/response';
import { validateCSRF } from '@/lib/api/csrf';
import { prisma } from '@/lib/prisma';

interface RouteParams {
  params: Promise<{ teamId: string }>;
}

export async function GET(request: NextRequest, { params }: RouteParams): Promise<NextResponse> {
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

    // Validate access
    await validateTeamAccess(user.id, teamId, 'viewer');

    const searchParams = request.nextUrl.searchParams;
    const skip = parseInt(searchParams.get('skip') || '0', 10);
    const take = parseInt(searchParams.get('take') || '50', 10);

    const members = await listMembers(teamId, { skip, take });

    return success({ members });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to list members';

    if (message.includes('Not a member') || message.includes('not found')) {
      return errors.forbidden(message);
    }

    return errors.internal(message);
  }
}

export async function POST(request: NextRequest, { params }: RouteParams): Promise<NextResponse> {
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
    const { email, role } = body;

    if (!email) {
      return errors.badRequest('Email is required');
    }

    // Validate role
    const validRoles: TeamRole[] = ['admin', 'member', 'viewer'];
    if (!validRoles.includes(role as TeamRole)) {
      return errors.badRequest('Invalid role. Must be admin, member, or viewer.');
    }

    const member = await inviteMember(
      teamId,
      { email, role: role as TeamRole },
      user.id
    );

    // Create plugin access records for all existing team plugins
    const teamPlugins = await prisma.teamPluginInstall.findMany({
      where: { teamId, status: 'active' },
      select: { id: true },
    });

    if (teamPlugins.length > 0) {
      await prisma.teamMemberPluginAccess.createMany({
        data: teamPlugins.map(install => ({
          memberId: member.id,
          pluginInstallId: install.id,
          visible: true,
          canUse: role !== 'viewer', // viewers can only view, not use
          canConfigure: ['owner', 'admin'].includes(role),
        })),
        skipDuplicates: true, // In case of race condition
      });
    }

    return success({ member });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to invite member';

    if (message.includes('already a member')) {
      return errors.conflict(message);
    }

    if (message.includes('not found')) {
      return errors.notFound('User');
    }

    return errors.badRequest(message);
  }
}
