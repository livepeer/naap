/**
 * Personal Plugin Preferences API
 *
 * Manages user plugin preferences for personal workspace.
 * - POST: Install/enable a plugin
 * - DELETE: Uninstall/disable a plugin
 * - GET: Get user's plugin preferences
 */

import {NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { validateSession } from '@/lib/api/auth';
import { success, errors, getAuthToken } from '@/lib/api/response';

// Core plugins that cannot be uninstalled
const CORE_PLUGINS = ['marketplace', 'plugin-publisher', 'pluginPublisher', 'my-wallet', 'my-dashboard'];

/**
 * GET /api/v1/base/plugins/preferences
 * Get user's plugin preferences
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const token = getAuthToken(request);
    if (!token) {
      return errors.unauthorized('Authentication required');
    }

    const user = await validateSession(token);
    if (!user) {
      return errors.unauthorized('Invalid session');
    }

    const preferences = await prisma.userPluginPreference.findMany({
      where: { userId: user.id },
      orderBy: { order: 'asc' },
    });

    return success({
      preferences: preferences.map(p => ({
        pluginName: p.pluginName,
        enabled: p.enabled,
        pinned: p.pinned,
        order: p.order,
      })),
    });
  } catch (err) {
    console.error('Error getting plugin preferences:', err);
    return errors.internal('Failed to get plugin preferences');
  }
}

/**
 * POST /api/v1/base/plugins/preferences
 * Install/enable a plugin for user
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
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
    const { pluginName, enabled = true, pinned = false, order } = body;

    if (!pluginName) {
      return errors.badRequest('Plugin name is required');
    }

    // Create or update user preference
    const preference = await prisma.userPluginPreference.upsert({
      where: {
        userId_pluginName: {
          userId: user.id,
          pluginName,
        },
      },
      update: {
        enabled,
        pinned,
        ...(order !== undefined && { order }),
      },
      create: {
        userId: user.id,
        pluginName,
        enabled,
        pinned,
        order: order ?? 0,
      },
    });

    return success({
      message: `Plugin "${pluginName}" has been ${enabled ? 'installed' : 'disabled'}`,
      preference: {
        pluginName: preference.pluginName,
        enabled: preference.enabled,
        pinned: preference.pinned,
        order: preference.order,
      },
    });
  } catch (err) {
    console.error('Error updating plugin preference:', err);
    return errors.internal('Failed to update plugin preference');
  }
}

/**
 * DELETE /api/v1/base/plugins/preferences
 * Uninstall/remove a plugin preference
 * Accepts pluginName via query param or request body
 */
export async function DELETE(request: NextRequest): Promise<NextResponse> {
  try {
    const token = getAuthToken(request);
    if (!token) {
      return errors.unauthorized('Authentication required');
    }

    const user = await validateSession(token);
    if (!user) {
      return errors.unauthorized('Invalid session');
    }

    // Accept pluginName from query param OR request body
    const { searchParams } = new URL(request.url);
    let pluginName = searchParams.get('pluginName');

    // If not in query params, try request body
    if (!pluginName) {
      try {
        const body = await request.json();
        pluginName = body.pluginName;
      } catch {
        // Body parsing failed, pluginName stays null
      }
    }

    if (!pluginName) {
      return errors.badRequest('Plugin name is required (via query param or request body)');
    }

    // Core plugins cannot be uninstalled
    if (CORE_PLUGINS.includes(pluginName)) {
      return errors.badRequest('Core plugins cannot be uninstalled');
    }

    // Delete the preference (truly uninstalls the plugin for the user)
    try {
      await prisma.userPluginPreference.delete({
        where: {
          userId_pluginName: {
            userId: user.id,
            pluginName,
          },
        },
      });
    } catch {
      // Preference may not exist — plugin is already uninstalled
    }

    return success({
      message: `Plugin "${pluginName}" has been uninstalled`,
      uninstalled: true,
    });
  } catch (err) {
    console.error('Error uninstalling plugin:', err);
    return errors.internal('Failed to uninstall plugin');
  }
}
