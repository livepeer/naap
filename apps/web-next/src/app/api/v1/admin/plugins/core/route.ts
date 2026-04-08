/**
 * Admin Core Plugins API
 *
 * GET  /api/v1/admin/plugins/core - List all plugins with isCore and visibleToUsers status
 * PUT  /api/v1/admin/plugins/core - Update which plugins are core and/or hidden
 *
 * When a plugin is marked as core, a UserPluginPreference record is
 * automatically created for every existing user who doesn't have one,
 * ensuring the plugin is installed for all users.
 *
 * Visibility (visibleToUsers) controls whether non-admin users see the
 * plugin in the sidebar and marketplace. Hidden plugins are still accessible
 * to admin users.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { validateSession } from '@/lib/api/auth';
import { success, errors, getAuthToken } from '@/lib/api/response';

const normalizePluginName = (name: string) =>
  name.toLowerCase().replace(/[-_]/g, '');

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
        visibleToUsers: true,
        previewTesterUserIds: true,
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
    const { corePluginNames, hiddenPluginNames, previewTesterUserIdsByPlugin } = body as {
      corePluginNames: string[];
      hiddenPluginNames?: string[];
      previewTesterUserIdsByPlugin?: Record<string, string[]>;
    };

    if (!Array.isArray(corePluginNames)) {
      return errors.badRequest('corePluginNames must be an array of plugin names');
    }

    // Resolve input names to actual DB names via normalization so that
    // "my_plugin" matches "my-plugin" in the database.
    const allPackages = await prisma.pluginPackage.findMany({
      where: { deprecated: false },
      select: { name: true, isCore: true },
    });
    const nameByNormalized = new Map(
      allPackages.map((p) => [normalizePluginName(p.name), p.name])
    );
    const resolveNames = (input: string[]) =>
      input
        .map((n) => nameByNormalized.get(normalizePluginName(n)))
        .filter((n): n is string => n !== undefined);

    const resolvedCoreNames = resolveNames(corePluginNames);
    const previousCoreNames = new Set(
      allPackages.filter((p) => p.isCore).map((p) => p.name)
    );

    // Determine newly added core plugins
    const newlyCore = resolvedCoreNames.filter((name) => !previousCoreNames.has(name));

    // Update core status and visibility in a single transaction
    const txOps = [
      prisma.pluginPackage.updateMany({
        where: { isCore: true },
        data: { isCore: false },
      }),
      ...(resolvedCoreNames.length > 0
        ? [
            prisma.pluginPackage.updateMany({
              where: { name: { in: resolvedCoreNames } },
              data: { isCore: true },
            }),
          ]
        : []),
    ];

    // Update visibility if hiddenPluginNames is provided
    if (Array.isArray(hiddenPluginNames)) {
      const resolvedHiddenNames = resolveNames(hiddenPluginNames);
      txOps.push(
        prisma.pluginPackage.updateMany({
          where: { deprecated: false },
          data: { visibleToUsers: true },
        }),
      );
      if (resolvedHiddenNames.length > 0) {
        txOps.push(
          prisma.pluginPackage.updateMany({
            where: { name: { in: resolvedHiddenNames } },
            data: { visibleToUsers: false },
          }),
        );
      }
    }

    await prisma.$transaction(txOps);

    if (
      previewTesterUserIdsByPlugin &&
      typeof previewTesterUserIdsByPlugin === 'object' &&
      !Array.isArray(previewTesterUserIdsByPlugin)
    ) {
      const allPkgs = await prisma.pluginPackage.findMany({
        where: { deprecated: false },
        select: { id: true, name: true },
      });
      const idByNormalized = new Map(
        allPkgs.map((p) => [normalizePluginName(p.name), p.id])
      );
      for (const [rawName, ids] of Object.entries(previewTesterUserIdsByPlugin)) {
        if (!Array.isArray(ids)) continue;
        const resolvedId = idByNormalized.get(normalizePluginName(rawName));
        if (!resolvedId) continue;
        const cleaned = [...new Set(ids.map((id) => String(id).trim()).filter(Boolean))];
        await prisma.pluginPackage.update({
          where: { id: resolvedId },
          data: { previewTesterUserIds: cleaned },
        });
      }
    }

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
        visibleToUsers: true,
        previewTesterUserIds: true,
      },
      orderBy: [{ isCore: 'desc' }, { displayName: 'asc' }],
    });

    const parts: string[] = [];
    if (newlyCore.length > 0) {
      parts.push(`Auto-installed ${newlyCore.join(', ')} for all users.`);
    }
    if (Array.isArray(hiddenPluginNames) && hiddenPluginNames.length > 0) {
      parts.push(`${hiddenPluginNames.length} plugin(s) hidden from non-admin users.`);
    }

    return success({
      plugins: updated,
      autoInstalled: newlyCore,
      message: parts.length > 0 ? parts.join(' ') : 'Plugin configuration updated.',
    });
  } catch (err) {
    console.error('Error updating core plugins:', err);
    return errors.internal('Failed to update core plugins');
  }
}
