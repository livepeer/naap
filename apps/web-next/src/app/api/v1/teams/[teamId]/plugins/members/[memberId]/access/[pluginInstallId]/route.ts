import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { validateSession } from '@/lib/api/auth';
import { validateTeamAccess } from '@/lib/api/teams';
import { getAuthToken, errors } from '@/lib/api/response';

// PUT /api/v1/teams/[teamId]/plugins/members/[memberId]/access/[pluginInstallId] - Set access
// Required role: admin
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ teamId: string; memberId: string; pluginInstallId: string }> }
) {
  try {
    const { teamId, memberId, pluginInstallId } = await params;

    // 1. Authenticate user
    const token = getAuthToken(request);
    if (!token) {
      return errors.unauthorized('No auth token provided');
    }
    const user = await validateSession(token);
    if (!user) {
      return errors.unauthorized('Invalid or expired session');
    }

    // 2. Validate team access (admin role required for managing access)
    try {
      await validateTeamAccess(user.id, teamId, 'admin');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Access denied';
      if (message.includes('not found')) {
        return errors.notFound('Team');
      }
      return errors.forbidden('You need admin role to manage member access');
    }

    const body = await request.json();
    const { visible, canUse, canConfigure, pluginRole } = body;

    // Verify member belongs to team
    const member = await prisma.teamMember.findFirst({
      where: { id: memberId, teamId },
    });

    if (!member) {
      return errors.notFound('Team member');
    }

    // Verify plugin install belongs to team
    const install = await prisma.teamPluginInstall.findFirst({
      where: { id: pluginInstallId, teamId },
      include: { deployment: { include: { package: true } } },
    });

    if (!install) {
      return errors.notFound('Plugin installation');
    }

    // Upsert access record
    const access = await prisma.teamMemberPluginAccess.upsert({
      where: {
        memberId_pluginInstallId: { memberId, pluginInstallId },
      },
      update: {
        visible: visible ?? true,
        canUse: canUse ?? true,
        canConfigure: canConfigure ?? false,
        pluginRole,
      },
      create: {
        memberId,
        pluginInstallId,
        visible: visible ?? true,
        canUse: canUse ?? true,
        canConfigure: canConfigure ?? false,
        pluginRole,
      },
    });

    return NextResponse.json({
      memberId,
      pluginInstallId,
      packageName: install.deployment.package.name,
      visible: access.visible,
      canUse: access.canUse,
      canConfigure: access.canConfigure,
      pluginRole: access.pluginRole,
      message: 'Member access updated successfully',
    });
  } catch (error) {
    console.error('Error updating member access:', error);
    return NextResponse.json(
      { error: 'Failed to update member access' },
      { status: 500 }
    );
  }
}

// DELETE /api/v1/teams/[teamId]/plugins/members/[memberId]/access/[pluginInstallId] - Remove access
// Required role: admin
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ teamId: string; memberId: string; pluginInstallId: string }> }
) {
  try {
    const { teamId, memberId, pluginInstallId } = await params;

    // 1. Authenticate user
    const token = getAuthToken(request);
    if (!token) {
      return errors.unauthorized('No auth token provided');
    }
    const user = await validateSession(token);
    if (!user) {
      return errors.unauthorized('Invalid or expired session');
    }

    // 2. Validate team access (admin role required for managing access)
    try {
      await validateTeamAccess(user.id, teamId, 'admin');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Access denied';
      if (message.includes('not found')) {
        return errors.notFound('Team');
      }
      return errors.forbidden('You need admin role to manage member access');
    }

    // Verify member belongs to team
    const member = await prisma.teamMember.findFirst({
      where: { id: memberId, teamId },
    });

    if (!member) {
      return errors.notFound('Team member');
    }

    // Delete access record
    await prisma.teamMemberPluginAccess.deleteMany({
      where: { memberId, pluginInstallId },
    });

    return NextResponse.json({
      success: true,
      message: 'Member access removed',
    });
  } catch (error) {
    console.error('Error removing member access:', error);
    return NextResponse.json(
      { error: 'Failed to remove member access' },
      { status: 500 }
    );
  }
}
