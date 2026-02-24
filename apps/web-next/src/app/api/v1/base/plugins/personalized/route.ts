/**
 * Personalized Plugins API Route
 * GET /api/v1/base/plugins/personalized - Get user-specific plugins
 *
 * Core plugins are determined dynamically from PluginPackage.isCore in the
 * database (configurable by admins). Core plugins are auto-installed for
 * users who don't have a preference record yet.
 *
 * NOTE: This GET endpoint performs a lazy write (auto-install) for core
 * plugins that haven't been provisioned for the user yet. This is a
 * deliberate design choice — it ensures core plugins are available on first
 * load without requiring a separate onboarding step. The operation is fully
 * idempotent (uses skipDuplicates) so repeated GETs produce the same result.
 * Cache-Control: no-store is set to prevent HTTP caches from serving stale data.
 */

import {NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { validateSession } from '@/lib/api/auth';
import { success, errors, getAuthToken } from '@/lib/api/response';

const normalizePluginName = (name: string) =>
  name.toLowerCase().replace(/[-_]/g, '');

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const searchParams = request.nextUrl.searchParams;
    let userIdOrAddress = searchParams.get('userId');
    const teamId = searchParams.get('teamId');

    // Also try to get user from auth token
    if (!userIdOrAddress) {
      const token = getAuthToken(request);
      if (token) {
        const sessionUser = await validateSession(token);
        if (sessionUser) {
          userIdOrAddress = sessionUser.id;
        }
      }
    }

    // Get all globally enabled plugins
    const globalPlugins = await prisma.workflowPlugin.findMany({
      where: { enabled: true },
      orderBy: { order: 'asc' },
    });

    // Get core plugin names from the database (admin-configurable via PluginPackage.isCore)
    const corePackages = await prisma.pluginPackage.findMany({
      where: { isCore: true },
      select: { name: true },
    });
    const corePluginNamesFromDB = new Set(
      corePackages.map((p) => normalizePluginName(p.name))
    );

    // Helper: is this plugin name a core plugin?
    const isCorePlugin = (name: string) =>
      corePluginNamesFromDB.has(normalizePluginName(name));

    // Headless plugins (no routes) are background data providers that must always
    // be loaded regardless of context — they register event bus handlers the shell
    // and dashboard rely on. We extract them once and append to every response.
    const headlessPlugins = globalPlugins.filter(
      (p) => !p.routes || (Array.isArray(p.routes) && (p.routes as string[]).length === 0),
    );

    if (!userIdOrAddress) {
      // No user context, return global plugins
      return success({ plugins: globalPlugins });
    }

    // Look up user by ID first (for email auth), then by address (wallet auth)
    let user = await prisma.user.findUnique({ where: { id: userIdOrAddress } });
    if (!user) {
      user = await prisma.user.findUnique({ where: { address: userIdOrAddress } });
    }

    if (!user) {
      // User doesn't exist yet, return global plugins
      return success({ plugins: globalPlugins });
    }

    // If team context, get team-specific plugin preferences
    if (teamId) {
      try {
        // Get team member's plugin preferences
        const teamMember = await prisma.teamMember.findFirst({
          where: {
            teamId,
            userId: user.id,
          },
        });

        if (teamMember) {
          // Get team plugin installs with member access preferences
          const teamPluginInstalls = await prisma.teamPluginInstall.findMany({
            where: { teamId, status: 'active' },
            include: {
              deployment: {
                include: {
                  package: true,
                  version: true,
                },
              },
              memberAccess: {
                where: { memberId: teamMember.id },
              },
            },
          });

          // Also get user's personal plugin preferences
          const userPreferences = await prisma.userPluginPreference.findMany({
            where: { userId: user.id },
          });
          const userPrefsMap = new Map(
            userPreferences.map((p) => [p.pluginName, p])
          );

          // Build plugins from team installs using deployment/package info.
          // Routes are resolved from WorkflowPlugin (authoritative source) so
          // that plugins installed from any location retain their correct routes.
          const workflowPluginMap = new Map(
            globalPlugins.map(wp => [normalizePluginName(wp.name), wp])
          );

          const teamPlugins = teamPluginInstalls
            .filter(install => install.deployment?.package)
            .map((install, idx) => {
              const memberPref = install.memberAccess?.[0];
              const pkg = install.deployment!.package!;
              const ver = install.deployment!.version;
              const userPref = userPrefsMap.get(pkg.name);
              const isEnabled = userPref !== undefined
                ? userPref.enabled
                : (memberPref ? memberPref.visible : install.enabled);
              const order = userPref?.order ?? idx;
              const isPinned = userPref?.pinned ?? false;

              // Use routes from WorkflowPlugin if available, fall back to generic
              const wp = workflowPluginMap.get(normalizePluginName(pkg.name));
              const routes = wp && Array.isArray(wp.routes) && (wp.routes as string[]).length > 0
                ? wp.routes as string[]
                : [`/${pkg.name || install.id}`, `/${pkg.name || install.id}/*`];

              return {
                installId: install.id,
                id: install.id,
                name: pkg.name || `plugin-${install.id}`,
                displayName: pkg.displayName || pkg.name || 'Unknown Plugin',
                description: pkg.description || '',
                version: ver?.version || '1.0.0',
                remoteUrl: wp?.remoteUrl || pkg.repository || '',
                bundleUrl: wp?.bundleUrl || undefined,
                globalName: wp?.globalName || undefined,
                stylesUrl: wp?.stylesUrl || undefined,
                routes,
                enabled: isEnabled,
                order: order,
                pinned: isPinned,
                icon: pkg.icon || undefined,
                isCore: pkg.isCore || isCorePlugin(pkg.name),
                category: pkg.category || 'other',
                metadata: {},
              };
            });

          // Get core plugins from global plugins (always available in team context)
          const coreGlobalPlugins = globalPlugins
            .filter(p => isCorePlugin(p.name))
            .map(plugin => ({
              ...plugin,
              enabled: true,
              isCore: true,
            }));

          // Combine team plugins with core plugins and headless providers
          const allTeamPlugins = [...teamPlugins, ...coreGlobalPlugins, ...headlessPlugins];

          // Sort and deduplicate
          const seenNames = new Set<string>();
          const personalizedPlugins = allTeamPlugins
            .filter((plugin) => {
              const normalized = normalizePluginName(plugin.name);
              if (seenNames.has(normalized)) return false;
              seenNames.add(normalized);
              return true;
            })
            .sort((a, b) => a.order - b.order);

          return success({ plugins: personalizedPlugins, context: 'team', teamId });
        }
      } catch (teamErr) {
        console.warn('Error fetching team plugins:', teamErr);
        const coreGlobalPlugins = globalPlugins
          .filter(p => isCorePlugin(p.name))
          .map(plugin => ({ ...plugin, enabled: true, isCore: true }));
        return success({ plugins: [...coreGlobalPlugins, ...headlessPlugins], context: 'team', teamId, error: 'Failed to load team plugins' });
      }

      // User is not a team member - return core plugins + headless providers
      const coreGlobalPlugins = globalPlugins
        .filter(p => isCorePlugin(p.name))
        .map(plugin => ({ ...plugin, enabled: true, isCore: true }));
      return success({ plugins: [...coreGlobalPlugins, ...headlessPlugins], context: 'team', teamId });
    }

    // =========================================================================
    // Personal context
    // =========================================================================

    // Get user preferences
    const userPreferences = await prisma.userPluginPreference.findMany({
      where: { userId: user.id },
    });

    const preferencesMap = new Map(
      userPreferences.map((p) => [p.pluginName, p])
    );

    // Auto-install core plugins: if the user doesn't have a preference record
    // for a core plugin, create one now so it counts as "installed"
    const corePluginsToAutoInstall: string[] = [];
    for (const plugin of globalPlugins) {
      if (isCorePlugin(plugin.name) && !preferencesMap.has(plugin.name)) {
        corePluginsToAutoInstall.push(plugin.name);
      }
    }
    if (corePluginsToAutoInstall.length > 0) {
      await prisma.userPluginPreference.createMany({
        data: corePluginsToAutoInstall.map((pluginName) => ({
          userId: user.id,
          pluginName,
          enabled: true,
          order: 0,
          pinned: false,
        })),
        skipDuplicates: true,
      });
      // Update the local map with the newly created preferences
      for (const pluginName of corePluginsToAutoInstall) {
        preferencesMap.set(pluginName, {
          id: '',
          userId: user.id,
          pluginName,
          enabled: true,
          order: 0,
          pinned: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      }
    }

    // Merge global plugins with user preferences.
    // Each plugin gets `installed` and `isCore` flags.
    const mergedPlugins = globalPlugins
      .map((plugin) => {
        const userPref = preferencesMap.get(plugin.name);
        const isCore = isCorePlugin(plugin.name);
        return {
          ...plugin,
          enabled: userPref ? userPref.enabled : plugin.enabled,
          order: userPref?.order ?? plugin.order,
          pinned: userPref?.pinned ?? false,
          installed: !!userPref || isCore,
          isCore,
        };
      })
      .sort((a, b) => {
        if (a.pinned && !b.pinned) return -1;
        if (!a.pinned && b.pinned) return 1;
        return a.order - b.order;
      });

    // Deduplicate by normalized name
    const seenNames = new Set<string>();
    const personalizedPlugins = mergedPlugins.filter((plugin) => {
      const normalized = normalizePluginName(plugin.name);
      if (seenNames.has(normalized)) {
        return false;
      }
      seenNames.add(normalized);
      return true;
    });

    const response = success({ plugins: personalizedPlugins, context: 'personal' });
    // Prevent HTTP caching since this endpoint may perform a lazy write (core plugin auto-install)
    response.headers.set('Cache-Control', 'no-store');
    return response;
  } catch (err) {
    console.error('Error fetching personalized plugins:', err);
    return errors.internal('Failed to fetch personalized plugins');
  }
}
