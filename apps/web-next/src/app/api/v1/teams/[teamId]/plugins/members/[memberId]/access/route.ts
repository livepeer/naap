import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { validateSession } from '@/lib/api/auth';
import { validateTeamAccess } from '@/lib/api/teams';
import { getAuthToken, errors } from '@/lib/api/response';

// GET /api/v1/teams/[teamId]/plugins/members/[memberId]/access - Get member access
// Required role: viewer
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ teamId: string; memberId: string }> }
) {
  try {
    const { teamId, memberId } = await params;

    // 1. Authenticate user
    const token = getAuthToken(request);
    if (!token) {
      return errors.unauthorized('No auth token provided');
    }
    const user = await validateSession(token);
    if (!user) {
      return errors.unauthorized('Invalid or expired session');
    }

    // 2. Validate team access (viewer role required)
    try {
      await validateTeamAccess(user.id, teamId, 'viewer');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Access denied';
      if (message.includes('not found')) {
        return errors.notFound('Team');
      }
      return errors.forbidden(message);
    }

    // Verify member belongs to team
    const member = await prisma.teamMember.findFirst({
      where: { id: memberId, teamId },
      include: { user: true },
    });

    if (!member) {
      return errors.notFound('Team member');
    }

    // Get all plugin access for this member
    const access = await prisma.teamMemberPluginAccess.findMany({
      where: { memberId },
      include: {
        pluginInstall: {
          include: {
            deployment: { include: { package: true } },
          },
        },
      },
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = access.map((a: any) => ({
      pluginInstallId: a.pluginInstallId,
      packageName: a.pluginInstall.deployment.package.name,
      displayName: a.pluginInstall.deployment.package.displayName,
      visible: a.visible,
      canUse: a.canUse,
      canConfigure: a.canConfigure,
      pluginRole: a.pluginRole,
      updatedAt: a.updatedAt,
    }));

    return NextResponse.json({
      memberId,
      memberName: member.user.displayName || member.user.email,
      memberRole: member.role,
      access: result,
    });
  } catch (error) {
    console.error('Error fetching member access:', error);
    return NextResponse.json(
      { error: 'Failed to fetch member access' },
      { status: 500 }
    );
  }
}
