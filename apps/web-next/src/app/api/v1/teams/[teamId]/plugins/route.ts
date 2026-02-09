import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { validateSession } from '@/lib/api/auth';
import { validateTeamAccess } from '@/lib/api/teams';
import { getAuthToken, errors } from '@/lib/api/response';

// GET /api/v1/teams/[teamId]/plugins - List team plugins
// Required role: viewer
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ teamId: string }> }
) {
  try {
    const { teamId } = await params;

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

    const plugins = await prisma.teamPluginInstall.findMany({
      where: { teamId },
      include: {
        deployment: {
          include: {
            package: true,
            version: true,
          },
        },
        pinnedVersion: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = plugins.map((p: any) => ({
      id: p.id,
      teamId: p.teamId,
      packageName: p.deployment.package.name,
      displayName: p.deployment.package.displayName,
      description: p.deployment.package.description,
      version: p.pinnedVersion?.version || p.deployment.version.version,
      icon: p.deployment.package.icon,
      status: p.status,
      enabled: p.enabled,
      installedBy: p.installedBy,
      isPinned: !!p.pinnedVersionId,
      frontendUrl: p.deployment.frontendUrl,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
    }));

    return NextResponse.json({
      success: true,
      data: {
        plugins: result,
      },
      meta: {
        total: result.length,
      },
    });
  } catch (error) {
    console.error('Error fetching team plugins:', error);
    return NextResponse.json(
      { error: 'Failed to fetch team plugins' },
      { status: 500 }
    );
  }
}

// POST /api/v1/teams/[teamId]/plugins - Install plugin for team
// Required role: owner (or admin)
//
// LEAN PLATFORM PATTERN:
// - Physical installation (PluginDeployment) only happens once per plugin on the platform
// - Virtual installations (TeamPluginInstall) are lightweight references to the deployment
// - activeInstalls counter tracks how many virtual installations reference the deployment
// - When the last virtual installation is removed, the deployment is physically deleted
//
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ teamId: string }> }
) {
  try {
    const { teamId } = await params;

    // 1. Authenticate user
    const token = getAuthToken(request);
    if (!token) {
      return errors.unauthorized('No auth token provided');
    }
    const user = await validateSession(token);
    if (!user) {
      return errors.unauthorized('Invalid or expired session');
    }

    // 2. Validate team access (admin role required for plugin installation)
    try {
      await validateTeamAccess(user.id, teamId, 'admin');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Access denied';
      if (message.includes('not found')) {
        return errors.notFound('Team');
      }
      return errors.forbidden('Only team owners and admins can install plugins');
    }

    const body = await request.json();
    const { deploymentId, packageId } = body;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let deployment: any = null;
    let pkg = null;

    // Support both deploymentId (direct) and packageId (lookup or create deployment)
    if (deploymentId) {
      deployment = await prisma.pluginDeployment.findUnique({
        where: { id: deploymentId },
        include: { package: true, version: true },
      });
    } else if (packageId) {
      // First, find the package and its latest version
      pkg = await prisma.pluginPackage.findUnique({
        where: { id: packageId },
        include: {
          versions: {
            where: { deprecated: false },
            orderBy: { publishedAt: 'desc' },
            take: 1,
          },
          deployment: {
            include: { version: true },
          },
        },
      });

      if (!pkg) {
        return NextResponse.json(
          { success: false, error: { code: 'NOT_FOUND', message: 'Plugin package not found' } },
          { status: 404 }
        );
      }

      // LEAN PLATFORM: Check if deployment already exists for this package
      // If it exists, we'll reuse it (virtual install only)
      // If not, we'll create it (physical install + virtual install)
      deployment = pkg.deployment;

      // If no deployment exists, this is the FIRST installation on the platform
      // Create the deployment (physical installation)
      if (!deployment && pkg.versions.length > 0) {
        const latestVersion = pkg.versions[0];
        deployment = await prisma.pluginDeployment.create({
          data: {
            packageId: pkg.id,
            versionId: latestVersion.id,
            status: 'running', // Mark as running since it's a CDN deployment
            frontendUrl: latestVersion.frontendUrl,
            deployedAt: new Date(),
            activeInstalls: 0, // Will be incremented in the transaction below
          },
          include: { package: true, version: true },
        });
      }
    } else {
      return NextResponse.json(
        { success: false, error: { code: 'BAD_REQUEST', message: 'Either deploymentId or packageId is required' } },
        { status: 400 }
      );
    }

    if (!deployment) {
      return NextResponse.json(
        { success: false, error: { code: 'NOT_FOUND', message: 'Plugin deployment not found and no versions available to create one' } },
        { status: 404 }
      );
    }

    // Check if already installed (by deployment)
    const existingByDeployment = await prisma.teamPluginInstall.findUnique({
      where: { teamId_deploymentId: { teamId, deploymentId: deployment.id } },
    });
    if (existingByDeployment) {
      return NextResponse.json(
        { success: false, error: { code: 'CONFLICT', message: 'Plugin already installed for this team' } },
        { status: 409 }
      );
    }

    // Use transaction to create install + default access records atomically
    const install = await prisma.$transaction(async (tx) => {
      // Increment activeInstalls on the deployment
      await tx.pluginDeployment.update({
        where: { id: deployment.id },
        data: { activeInstalls: { increment: 1 } },
      });

      // Create team plugin install with installedBy set to current user
      const newInstall = await tx.teamPluginInstall.create({
        data: {
          teamId,
          deploymentId: deployment.id,
          installedBy: user.id,
          status: 'active',
          enabled: true,
        },
        include: {
          deployment: {
            include: { package: true, version: true },
          },
        },
      });

      // Get all current team members
      const members = await tx.teamMember.findMany({
        where: { teamId },
        select: { id: true, role: true },
      });

      // Create default access for each member
      // Owners/admins get canConfigure, viewers can only view, members can use
      if (members.length > 0) {
        await tx.teamMemberPluginAccess.createMany({
          data: members.map(member => ({
            memberId: member.id,
            pluginInstallId: newInstall.id,
            visible: true,
            canUse: member.role !== 'viewer', // viewers can only view, not use
            canConfigure: ['owner', 'admin'].includes(member.role),
          })),
        });
      }

      return newInstall;
    });

    return NextResponse.json({
      success: true,
      data: {
        id: install.id,
        packageName: install.deployment.package.name,
        displayName: install.deployment.package.displayName,
        version: install.deployment.version?.version,
        status: install.status,
        enabled: install.enabled,
      },
      message: 'Plugin installed successfully',
    }, { status: 201 });
  } catch (error) {
    console.error('Error installing team plugin:', error);
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to install plugin' } },
      { status: 500 }
    );
  }
}
