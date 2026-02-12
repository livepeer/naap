/**
 * Plugin Installations List API
 *
 * GET  /api/v1/installations - List user's installed plugins
 * POST /api/v1/installations - Install a plugin (create user preference)
 */

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { validateSession } from '@/lib/api/auth';
import { success, errors, getAuthToken } from '@/lib/api/response';

/**
 * GET /api/v1/installations - List installed plugins for the authenticated user
 */
export async function GET(request: NextRequest) {
  try {
    const token = getAuthToken(request);
    if (!token) {
      return errors.unauthorized('Authentication required');
    }

    const user = await validateSession(token);
    if (!user) {
      return errors.unauthorized('Invalid session');
    }

    // Get all user plugin preferences that are enabled
    const preferences = await prisma.userPluginPreference.findMany({
      where: { userId: user.id, enabled: true },
      orderBy: { pluginName: 'asc' },
    });

    // Enrich with package info
    const installations = await Promise.all(
      preferences.map(async (pref) => {
        const pkg = await prisma.pluginPackage.findFirst({
          where: { name: pref.pluginName },
          include: {
            versions: {
              orderBy: { publishedAt: 'desc' },
              take: 1,
            },
          },
        });

        return {
          id: pref.id,
          packageId: pkg?.id ?? '',
          status: 'active' as const,
          package: {
            name: pref.pluginName,
            displayName: pkg?.displayName ?? pref.pluginName,
            version: pkg?.versions?.[0]?.version ?? '1.0.0',
            category: pkg?.category ?? 'other',
          },
        };
      })
    );

    return success({ installations });
  } catch (err) {
    console.error('Error listing installations:', err);
    return errors.internal('Failed to list installations');
  }
}

/**
 * POST /api/v1/installations - Install a plugin for the authenticated user
 */
export async function POST(request: NextRequest) {
  try {
    const token = getAuthToken(request);
    if (!token) {
      return errors.unauthorized('Authentication required');
    }

    const user = await validateSession(token);
    if (!user) {
      return errors.unauthorized('Invalid session');
    }

    const body = await request.json();
    const { packageName } = body;

    if (!packageName) {
      return errors.badRequest('packageName is required');
    }

    // Verify package exists
    const pkg = await prisma.pluginPackage.findFirst({
      where: { name: packageName },
    });

    if (!pkg) {
      return errors.notFound(`Plugin "${packageName}" not found`);
    }

    // Upsert user preference (enable the plugin)
    const preference = await prisma.userPluginPreference.upsert({
      where: {
        userId_pluginName: {
          userId: user.id,
          pluginName: packageName,
        },
      },
      update: { enabled: true },
      create: {
        userId: user.id,
        pluginName: packageName,
        enabled: true,
        pinned: false,
      },
    });

    return success({
      installation: {
        id: preference.id,
        packageId: pkg.id,
        status: 'active',
        package: {
          name: packageName,
          displayName: pkg.displayName,
        },
      },
    }, 201);
  } catch (err) {
    console.error('Error installing plugin:', err);
    return errors.internal('Failed to install plugin');
  }
}
