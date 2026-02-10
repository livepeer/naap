/**
 * Plugin Installation Management API
 *
 * Manages plugin installations for users.
 * Fixed to use proper session authentication instead of x-user-id header.
 */

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { validateSession } from '@/lib/api/auth';
import { success, errors, getAuthToken } from '@/lib/api/response';

// Core plugins that cannot be uninstalled
const CORE_PLUGINS = ['marketplace', 'plugin-publisher', 'pluginPublisher', 'my-wallet', 'my-dashboard'];

/**
 * DELETE /api/v1/installations/:name - Uninstall a plugin
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  try {
    const { name } = await params;

    if (!name) {
      return errors.badRequest('Plugin name is required');
    }

    // Core plugins cannot be uninstalled
    if (CORE_PLUGINS.includes(name)) {
      return errors.badRequest('Core plugins cannot be uninstalled');
    }

    // Get authenticated user
    const token = getAuthToken(request);
    if (!token) {
      return errors.unauthorized('Authentication required');
    }

    const user = await validateSession(token);
    if (!user) {
      return errors.unauthorized('Invalid session');
    }

    // Remove user preference for this plugin (truly delete, not just disable)
    try {
      await prisma.userPluginPreference.delete({
        where: {
          userId_pluginName: {
            userId: user.id,
            pluginName: name,
          },
        },
      });
    } catch {
      // Preference may not exist — plugin is already uninstalled
    }

    return success({
      message: `Plugin "${name}" has been uninstalled`,
      uninstalled: true,
    });
  } catch (err) {
    console.error('Error uninstalling plugin:', err);
    return errors.internal('Failed to uninstall plugin');
  }
}

/**
 * GET /api/v1/installations/:name - Get installation info
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  try {
    const { name } = await params;

    if (!name) {
      return errors.badRequest('Plugin name is required');
    }

    // Get authenticated user
    const token = getAuthToken(request);
    let userId: string | null = null;

    if (token) {
      const user = await validateSession(token);
      userId = user?.id || null;
    }

    // Check if user has this plugin enabled
    let userPreference = null;
    if (userId) {
      userPreference = await prisma.userPluginPreference.findUnique({
        where: {
          userId_pluginName: {
            userId,
            pluginName: name,
          },
        },
      });
    }

    // Get package info from marketplace with latest version
    const pkg = await prisma.pluginPackage.findFirst({
      where: { name },
      include: {
        versions: {
          orderBy: { publishedAt: 'desc' },
          take: 1,
        },
      },
    });

    return success({
      name,
      installed: userPreference?.enabled ?? false,
      enabled: userPreference?.enabled ?? false,
      pinned: userPreference?.pinned ?? false,
      package: pkg ? {
        displayName: pkg.displayName,
        version: pkg.versions?.[0]?.version ?? '1.0.0',
        category: pkg.category,
      } : null,
    });
  } catch (err) {
    console.error('Error getting installation info:', err);
    return errors.internal('Failed to get installation info');
  }
}
