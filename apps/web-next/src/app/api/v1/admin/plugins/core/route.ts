/**
 * Admin Core Plugins API
 *
 * GET  /api/v1/admin/plugins/core - List all plugins with isCore status
 * PUT  /api/v1/admin/plugins/core - Update which plugins are core
 *
 * When a plugin is marked as core, a UserPluginPreference record is
 * automatically created for every existing user who doesn't have one,
 * ensuring the plugin is installed for all users.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { validateSession } from '@/lib/api/auth';
import { success, errors, getAuthToken } from '@/lib/api/response';

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const token = getAuthToken(request);
    if (!token) {
      return errors.unauthorized('Authentication required');
    }

    const sessionUser = await validateSession(token);
    if (!sessionUser) {
      return errors.unauthorized('Invalid session');
    }

    // Admin only
    if (!sessionUser.roles.includes('system:admin')) {
      return errors.forbidden('Admin permission required');
    }

    // Get all plugin packages with their core status
    const packages = await prisma.pluginPackage.findMany({
      where: { deprecated: false },
      select: {
        id: true,
        name: true,
        displayName: true,
        description: true,
        category: true,
        icon: true,
        isCore: true,
      },
      orderBy: [{ isCore: 'desc' }, { displayName: 'asc' }],
    });

    return success({ plugins: packages });
  } catch (err) {
    console.error('Error fetching core plugins:', err);
    return errors.internal('Failed to fetch plugins');
  }
}

export async function PUT(request: NextRequest): Promise<NextResponse> {
  try {
    const token = getAuthToken(request);
    if (!token) {
      return errors.unauthorized('Authentication required');
    }

    const sessionUser = await validateSession(token);
    if (!sessionUser) {
      return errors.unauthorized('Invalid session');
    }

    // Admin only
    if (!sessionUser.roles.includes('system:admin')) {
      return errors.forbidden('Admin permission required');
    }

    const body = await request.json();
    const { corePluginNames } = body as { corePluginNames: string[] };

    if (!Array.isArray(corePluginNames)) {
      return errors.badRequest('corePluginNames must be an array of plugin names');
    }

    // Get current core plugins before update
    const previousCore = await prisma.pluginPackage.findMany({
      where: { isCore: true },
      select: { name: true },
    });
    const previousCoreNames = new Set(previousCore.map((p) => p.name));

    // Determine newly added core plugins
    const newlyCore = corePluginNames.filter((name) => !previousCoreNames.has(name));

    // Update all packages: set isCore=false for all, then isCore=true for selected
    await prisma.$transaction([
      prisma.pluginPackage.updateMany({
        where: { isCore: true },
        data: { isCore: false },
      }),
      ...(corePluginNames.length > 0
        ? [
            prisma.pluginPackage.updateMany({
              where: { name: { in: corePluginNames } },
              data: { isCore: true },
            }),
          ]
        : []),
    ]);

    // Auto-install newly-core plugins for all existing users who don't have them
    if (newlyCore.length > 0) {
      const allUsers = await prisma.user.findMany({ select: { id: true } });

      for (const pluginName of newlyCore) {
        // Find users who already have a preference for this plugin
        const existingPrefs = await prisma.userPluginPreference.findMany({
          where: { pluginName },
          select: { userId: true },
        });
        const usersWithPref = new Set(existingPrefs.map((p) => p.userId));

        // Create preferences for users who don't have one
        const missingUsers = allUsers.filter((u) => !usersWithPref.has(u.id));
        if (missingUsers.length > 0) {
          await prisma.userPluginPreference.createMany({
            data: missingUsers.map((u) => ({
              userId: u.id,
              pluginName,
              enabled: true,
              order: 0,
              pinned: false,
            })),
            skipDuplicates: true,
          });
        }
      }
    }

    // Return updated list
    const updated = await prisma.pluginPackage.findMany({
      where: { deprecated: false },
      select: {
        id: true,
        name: true,
        displayName: true,
        description: true,
        category: true,
        icon: true,
        isCore: true,
      },
      orderBy: [{ isCore: 'desc' }, { displayName: 'asc' }],
    });

    return success({
      plugins: updated,
      autoInstalled: newlyCore,
      message: `Core plugins updated. ${newlyCore.length > 0 ? `Auto-installed ${newlyCore.join(', ')} for all users.` : ''}`,
    });
  } catch (err) {
    console.error('Error updating core plugins:', err);
    return errors.internal('Failed to update core plugins');
  }
}
