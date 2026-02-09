import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { validateSession } from '@/lib/api/auth';
import { validateTeamAccess } from '@/lib/api/teams';
import { getAuthToken, errors } from '@/lib/api/response';

// PATCH /api/v1/teams/[teamId]/plugins/[installId]/toggle - Enable/disable plugin
// Required role: admin
export async function PATCH(
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

    // 2. Validate team access (admin role required for toggle)
    try {
      await validateTeamAccess(user.id, teamId, 'admin');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Access denied';
      if (message.includes('not found')) {
        return errors.notFound('Team');
      }
      return errors.forbidden('You need admin role to enable/disable plugins');
    }

    const body = await request.json();
    const { enabled } = body;

    if (typeof enabled !== 'boolean') {
      return errors.badRequest('enabled must be a boolean');
    }

    const install = await prisma.teamPluginInstall.findFirst({
      where: { id: installId, teamId },
    });

    if (!install) {
      return errors.notFound('Plugin installation');
    }

    const updated = await prisma.teamPluginInstall.update({
      where: { id: installId },
      data: {
        enabled,
        status: enabled ? 'active' : 'disabled',
      },
      include: {
        deployment: { include: { package: true } },
      },
    });

    return NextResponse.json({
      id: updated.id,
      packageName: updated.deployment.package.name,
      enabled: updated.enabled,
      status: updated.status,
      message: `Plugin ${enabled ? 'enabled' : 'disabled'} successfully`,
    });
  } catch (error) {
    console.error('Error toggling plugin:', error);
    return NextResponse.json(
      { error: 'Failed to toggle plugin' },
      { status: 500 }
    );
  }
}
