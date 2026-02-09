import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { validateSession } from '@/lib/api/auth';
import { validateTeamAccess } from '@/lib/api/teams';
import { getAuthToken, errors } from '@/lib/api/response';

// GET /api/v1/teams/[teamId]/plugins/[installId] - Get specific plugin install
// Required role: viewer
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ teamId: string; installId: string }> }
) {
  try {
    const { teamId, installId } = await params;

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

    const install = await prisma.teamPluginInstall.findFirst({
      where: { id: installId, teamId },
      include: {
        deployment: {
          include: {
            package: true,
            version: true,
          },
        },
        pinnedVersion: true,
        memberAccess: {
          include: { member: { include: { user: true } } },
        },
      },
    });

    if (!install) {
      return NextResponse.json(
        { error: 'Plugin installation not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      id: install.id,
      teamId: install.teamId,
      packageName: install.deployment.package.name,
      displayName: install.deployment.package.displayName,
      description: install.deployment.package.description,
      version: install.pinnedVersion?.version || install.deployment.version.version,
      icon: install.deployment.package.icon,
      status: install.status,
      enabled: install.enabled,
      installedBy: install.installedBy,
      sharedConfig: install.sharedConfig,
      pinnedVersionId: install.pinnedVersionId,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      memberAccess: install.memberAccess.map((a: any) => ({
        memberId: a.memberId,
        userId: a.member.userId,
        displayName: a.member.user.displayName,
        visible: a.visible,
        canUse: a.canUse,
        canConfigure: a.canConfigure,
        pluginRole: a.pluginRole,
      })),
      createdAt: install.createdAt,
      updatedAt: install.updatedAt,
    });
  } catch (error) {
    console.error('Error fetching team plugin:', error);
    return NextResponse.json(
      { error: 'Failed to fetch plugin installation' },
      { status: 500 }
    );
  }
}

// DELETE /api/v1/teams/[teamId]/plugins/[installId] - Uninstall plugin
// Required role: admin (or higher)
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ teamId: string; installId: string }> }
) {
  try {
    const { teamId, installId } = await params;

    // 1. Authenticate user
    const token = getAuthToken(request);
    if (!token) {
      return errors.unauthorized('No auth token provided');
    }
    const user = await validateSession(token);
    if (!user) {
      return errors.unauthorized('Invalid or expired session');
    }

    // 2. Validate team access (admin role required for plugin management)
    try {
      await validateTeamAccess(user.id, teamId, 'admin');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Access denied';
      if (message.includes('not found')) {
        return errors.notFound('Team');
      }
      return errors.forbidden('Only team admins and owners can uninstall plugins');
    }

    const install = await prisma.teamPluginInstall.findFirst({
      where: { id: installId, teamId },
      include: { deployment: { include: { package: true } } },
    });

    if (!install) {
      return errors.notFound('Plugin installation');
    }

    // Use transaction to delete installation and manage deployment lifecycle
    const result = await prisma.$transaction(async (tx) => {
      // Delete the installation (cascades to member access and configs)
      await tx.teamPluginInstall.delete({
        where: { id: installId },
      });

      // Decrement activeInstalls on the deployment and get the new count
      const updatedDeployment = await tx.pluginDeployment.update({
        where: { id: install.deploymentId },
        data: { activeInstalls: { decrement: 1 } },
        select: { id: true, activeInstalls: true, packageId: true },
      });

      // LEAN PLATFORM PATTERN:
      // If this was the last installation (activeInstalls = 0), physically uninstall
      // by deleting the deployment. This keeps the platform lean by not keeping
      // unused deployments around.
      let physicallyUninstalled = false;
      if (updatedDeployment.activeInstalls <= 0) {
        // Check if there are any other references (tenant installs)
        const tenantInstallCount = await tx.tenantPluginInstall.count({
          where: { deploymentId: install.deploymentId },
        });

        if (tenantInstallCount === 0) {
          // No more references - safe to physically uninstall (delete deployment)
          await tx.pluginDeployment.delete({
            where: { id: install.deploymentId },
          });
          physicallyUninstalled = true;
        }
      }

      return { physicallyUninstalled };
    });

    return NextResponse.json({
      success: true,
      data: {
        uninstalled: true,
        packageName: install.deployment.package.name,
        physicallyUninstalled: result.physicallyUninstalled,
      },
      message: result.physicallyUninstalled
        ? `${install.deployment.package.displayName} completely removed from platform`
        : `${install.deployment.package.displayName} uninstalled from team`,
    });
  } catch (error) {
    console.error('Error uninstalling team plugin:', error);
    return NextResponse.json(
      { error: 'Failed to uninstall plugin' },
      { status: 500 }
    );
  }
}
