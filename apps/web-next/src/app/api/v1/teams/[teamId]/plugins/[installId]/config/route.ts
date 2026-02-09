import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { validateSession } from '@/lib/api/auth';
import { validateTeamAccess } from '@/lib/api/teams';
import { getAuthToken, errors } from '@/lib/api/response';

// PUT /api/v1/teams/[teamId]/plugins/[installId]/config - Update plugin config
// Required role: admin
export async function PUT(
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

    // 2. Validate team access (admin role required for configuration)
    try {
      await validateTeamAccess(user.id, teamId, 'admin');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Access denied';
      if (message.includes('not found')) {
        return errors.notFound('Team');
      }
      return errors.forbidden('You need admin role to configure plugins');
    }

    const body = await request.json();
    const { sharedConfig } = body;

    const install = await prisma.teamPluginInstall.findFirst({
      where: { id: installId, teamId },
    });

    if (!install) {
      return errors.notFound('Plugin installation');
    }

    const updated = await prisma.teamPluginInstall.update({
      where: { id: installId },
      data: { sharedConfig },
      include: {
        deployment: { include: { package: true } },
      },
    });

    return NextResponse.json({
      id: updated.id,
      packageName: updated.deployment.package.name,
      sharedConfig: updated.sharedConfig,
      message: 'Plugin configuration updated successfully',
    });
  } catch (error) {
    console.error('Error updating plugin config:', error);
    return NextResponse.json(
      { error: 'Failed to update plugin configuration' },
      { status: 500 }
    );
  }
}

// GET /api/v1/teams/[teamId]/plugins/[installId]/config - Get plugin config
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
        deployment: { include: { package: true } },
      },
    });

    if (!install) {
      return errors.notFound('Plugin installation');
    }

    return NextResponse.json({
      id: install.id,
      packageName: install.deployment.package.name,
      sharedConfig: install.sharedConfig,
    });
  } catch (error) {
    console.error('Error fetching plugin config:', error);
    return NextResponse.json(
      { error: 'Failed to fetch plugin configuration' },
      { status: 500 }
    );
  }
}
