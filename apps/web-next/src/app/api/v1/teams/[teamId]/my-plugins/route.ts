import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { success, errors, getAuthToken } from '@/lib/api/response';
import { validateSession } from '@/lib/api/auth';

/**
 * GET /api/v1/teams/[teamId]/my-plugins
 * Get plugins installed for the current user within a team context.
 * Returns plugins with user-specific visibility settings.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ teamId: string }> }
) {
  try {
    const { teamId } = await params;

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

    // Get team plugin installations with deployment and package info
    const teamInstalls = await prisma.teamPluginInstall.findMany({
      where: { teamId, status: 'active' },
      include: {
        deployment: {
          include: {
            package: true,
            version: true,
          },
        },
        memberAccess: {
          where: { memberId: membership.id },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    // Get global plugins for fallback info
    const globalPlugins = await prisma.workflowPlugin.findMany({
      where: { enabled: true },
    });

    const globalPluginsMap = new Map(
      globalPlugins.map(p => [p.name.toLowerCase().replace(/[-_]/g, ''), p])
    );

    // Build team plugins list with member access preferences
    const validInstalls = teamInstalls.filter(install => install.deployment?.package);
    
    // If team has no plugin installs, fall back to global plugins
    if (validInstalls.length === 0) {
      const fallbackPlugins = globalPlugins.map((plugin, index) => ({
        id: plugin.name,
        installId: undefined,
        name: plugin.name,
        displayName: plugin.displayName,
        version: plugin.version,
        remoteUrl: plugin.remoteUrl || '',
        routes: plugin.routes || [`/plugins/${plugin.name}/*`],
        enabled: plugin.enabled,
        visible: plugin.enabled,
        pinned: false,
        order: plugin.order ?? index,
        icon: plugin.icon,
        isCore: false,
        canConfigure: false,
        installedAt: null,
        installedBy: null,
      }));

      return success({
        plugins: fallbackPlugins,
        team: {
          id: teamId,
          role: membership.role,
        },
        fallback: true, // Indicates we're using global plugins as fallback
      });
    }

    const plugins = validInstalls.map((install, index) => {
      const pkg = install.deployment!.package!;
      const ver = install.deployment!.version;
      const memberPref = install.memberAccess?.[0];
      const normalizedName = pkg.name.toLowerCase().replace(/[-_]/g, '');
      const globalPlugin = globalPluginsMap.get(normalizedName);

      return {
        id: install.id,
        installId: install.id,
        name: pkg.name,
        displayName: pkg.displayName || pkg.name,
        version: ver?.version || '1.0.0',
        remoteUrl: pkg.repository || globalPlugin?.remoteUrl || '',
        routes: globalPlugin?.routes || [`/plugins/${pkg.name}/*`],
        enabled: memberPref?.visible ?? install.enabled,
        visible: memberPref?.visible ?? install.enabled,
        pinned: false,
        order: index,
        icon: pkg.icon || globalPlugin?.icon,
        isCore: false,
        canConfigure: membership.role === 'owner' || membership.role === 'admin',
        installedAt: install.createdAt,
        installedBy: install.installedBy,
      };
    });

    // Sort by order, then by pinned
    plugins.sort((a, b) => {
      if (a.pinned && !b.pinned) return -1;
      if (!a.pinned && b.pinned) return 1;
      return a.order - b.order;
    });

    return success({
      plugins,
      team: {
        id: teamId,
        role: membership.role,
      },
    });
  } catch (err) {
    console.error('Error fetching team plugins:', err);
    return errors.internal('Failed to fetch team plugins');
  }
}
