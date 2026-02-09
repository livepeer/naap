import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { success, errors, getAuthToken } from '@/lib/api/response';
import { validateSession } from '@/lib/api/auth';

/**
 * PUT /api/v1/teams/[teamId]/members/me/plugins/[installId]
 * Update user's visibility/preference for a team plugin.
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ teamId: string; installId: string }> }
) {
  try {
    const { teamId, installId } = await params;

    // Get user from auth token
    const token = getAuthToken(request);
    if (!token) {
      return errors.unauthorized('Authentication required');
    }

    const sessionUser = await validateSession(token);
    if (!sessionUser) {
      return errors.unauthorized('Invalid session');
    }

    const userId = sessionUser.id;

    // Verify user is a member of this team
    const membership = await prisma.teamMember.findUnique({
      where: {
        teamId_userId: { teamId, userId },
      },
    });

    if (!membership) {
      return errors.forbidden('Not a member of this team');
    }

    // Get the team plugin installation with deployment info
    const install = await prisma.teamPluginInstall.findUnique({
      where: { id: installId },
      include: {
        deployment: {
          include: {
            package: true,
          },
        },
      },
    });

    if (!install || install.teamId !== teamId) {
      return errors.notFound('Plugin installation');
    }

    const pluginName = install.deployment?.package?.name;
    if (!pluginName) {
      return errors.notFound('Plugin package');
    }

    const body = await request.json();
    const { visible, pinned, order } = body;

    // Update user preference for this plugin
    await prisma.userPluginPreference.upsert({
      where: {
        userId_pluginName: {
          userId,
          pluginName,
        },
      },
      update: {
        enabled: visible ?? true,
        pinned: pinned ?? false,
        order: order ?? 100,
      },
      create: {
        userId,
        pluginName,
        enabled: visible ?? true,
        pinned: pinned ?? false,
        order: order ?? 100,
      },
    });

    return success({
      message: 'Plugin preference updated',
      preference: {
        pluginName,
        visible: visible ?? true,
        pinned: pinned ?? false,
        order: order ?? 100,
      },
    });
  } catch (err) {
    console.error('Error updating team plugin preference:', err);
    return errors.internal('Failed to update plugin preference');
  }
}

/**
 * GET /api/v1/teams/[teamId]/members/me/plugins/[installId]
 * Get user's preference for a team plugin.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ teamId: string; installId: string }> }
) {
  try {
    const { teamId, installId } = await params;

    // Get user from auth token
    const token = getAuthToken(request);
    if (!token) {
      return errors.unauthorized('Authentication required');
    }

    const sessionUser = await validateSession(token);
    if (!sessionUser) {
      return errors.unauthorized('Invalid session');
    }

    const userId = sessionUser.id;

    // Verify user is a member of this team
    const membership = await prisma.teamMember.findUnique({
      where: {
        teamId_userId: { teamId, userId },
      },
    });

    if (!membership) {
      return errors.forbidden('Not a member of this team');
    }

    // Get the team plugin installation with deployment info
    const install = await prisma.teamPluginInstall.findUnique({
      where: { id: installId },
      include: {
        deployment: {
          include: {
            package: true,
          },
        },
      },
    });

    if (!install || install.teamId !== teamId) {
      return errors.notFound('Plugin installation');
    }

    const pluginName = install.deployment?.package?.name;
    if (!pluginName) {
      return errors.notFound('Plugin package');
    }

    // Get user preference
    const preference = await prisma.userPluginPreference.findUnique({
      where: {
        userId_pluginName: {
          userId,
          pluginName,
        },
      },
    });

    return success({
      preference: preference ? {
        pluginName,
        visible: preference.enabled,
        pinned: preference.pinned,
        order: preference.order,
      } : null,
    });
  } catch (err) {
    console.error('Error fetching team plugin preference:', err);
    return errors.internal('Failed to fetch plugin preference');
  }
}
