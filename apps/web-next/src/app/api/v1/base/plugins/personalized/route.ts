/**
 * Personalized Plugins API Route
 * GET /api/v1/base/plugins/personalized - Get user-specific plugins
 *
 * Core plugins are determined dynamically from PluginPackage.isCore in the
 * database (configurable by admins). Core plugins are auto-installed for
 * users who don't have a preference record yet.
 *
 * NOTE: This GET endpoint performs a lazy write (auto-install) for core
 * plugins and for hidden preview plugins when the user is on previewTesterUserIds.
 * Idempotent (skipDuplicates); Cache-Control: no-store.
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

    // Admin status is derived exclusively from the authenticated session token.
    // Never trust userId query params for privilege — a caller who knows an
    // admin's ID must not gain admin-level visibility.
    let isAdmin = false;
    let authenticatedUserId: string | null = null;
    const token = getAuthToken(request);
    if (token) {
      const sessionUser = await validateSession(token);
      if (sessionUser) {
        isAdmin = sessionUser.roles?.includes('system:admin') ?? false;
        authenticatedUserId = sessionUser.id;
        if (!userIdOrAddress) {
          userIdOrAddress = sessionUser.id;
        }
      }
    }

    // Get all globally enabled plugins
    const globalPlugins = await prisma.workflowPlugin.findMany({
      where: { enabled: true },
      orderBy: { order: 'asc' },
    });

    // Publish-gate: only show plugins that have a published PluginPackage.
    // This prevents plugins synced from stale branches (or preview deploys on
    // a shared DB) from appearing in the UI when their package is unlisted/draft.
    // Also fetch visibleToUsers for admin-controlled visibility filtering.
    const publishedPackages = await prisma.pluginPackage.findMany({
      where: { publishStatus: 'published', deprecated: false },
      select: { name: true, isCore: true, visibleToUsers: true, previewTesterUserIds: true },
    });
    const publishedNames = new Set(
      publishedPackages.map((p) => normalizePluginName(p.name))
    );
    const hiddenNames = new Set(
      publishedPackages
        .filter((p) => !p.visibleToUsers)
        .map((p) => normalizePluginName(p.name))
    );
    const publishedPackageByNormalizedName = new Map(
      publishedPackages.map((p) => [normalizePluginName(p.name), p])
    );

    // Get core plugin names from the database (admin-configurable via PluginPackage.isCore)
    const corePluginNamesFromDB = new Set(
      publishedPackages.filter((p) => p.isCore).map((p) => normalizePluginName(p.name))
    );

    // Helper: is this plugin name a core plugin?
    const isCorePlugin = (name: string) =>
      corePluginNamesFromDB.has(normalizePluginName(name));

    // Publish-gated global plugins (visibility filter NOT applied yet).
    // Used to extract headless plugins which must always load.
    const publishedGlobalPlugins = globalPlugins.filter((p) =>
      publishedNames.has(normalizePluginName(p.name))
    );

    // Apply publish-gate + visibility-gate. Deferred into a function so it
    // can be called after admin status is fully resolved (token OR DB lookup).
    // Non-admins see hidden plugins only if their user id is on previewTesterUserIds
    // for that package. Admins impersonating another user (userId query) use the
    // target user's id for preview visibility; everyone else uses the session user.
    const applyVisibilityFilter = (adminFlag: boolean, previewViewerUserId: string | null) =>
      publishedGlobalPlugins.filter((p) => {
        if (adminFlag) return true;
        const norm = normalizePluginName(p.name);
        if (!hiddenNames.has(norm)) return true;
        const pkg = publishedPackageByNormalizedName.get(norm);
        if (
          previewViewerUserId &&
          pkg?.previewTesterUserIds?.includes(previewViewerUserId)
        ) {
          return true;
        }
        return false;
      });

    // Headless plugins (no routes) are background data providers that must always
    // be loaded regardless of context — they register event bus handlers the shell
    // and dashboard rely on. Derived from the publish-gated set WITHOUT the
    // visibility gate so hidden headless providers still load for non-admin users.
    const headlessPlugins = publishedGlobalPlugins.filter(
      (p) => !p.routes || (Array.isArray(p.routes) && (p.routes as string[]).length === 0),
    );

    if (!userIdOrAddress) {
      const visibleGlobalPlugins = applyVisibilityFilter(isAdmin, null);
      return success({ plugins: visibleGlobalPlugins });
    }

    // Look up user by ID first (for email auth), then by address (wallet auth)
    let user = await prisma.user.findUnique({ where: { id: userIdOrAddress } });
    if (!user) {
      user = await prisma.user.findUnique({ where: { address: userIdOrAddress } });
    }

    if (!user) {
      const visibleGlobalPlugins = applyVisibilityFilter(isAdmin, null);
      return success({ plugins: visibleGlobalPlugins });
    }

    // Only elevate to admin via DB role lookup when the authenticated session
    // user matches the looked-up user. This prevents privilege escalation via
    // a crafted userId query parameter.
    if (!isAdmin && authenticatedUserId && authenticatedUserId === user.id) {
      const userRoles = await prisma.userRole.findMany({
        where: { userId: user.id },
        include: { role: { select: { name: true } } },
      });
      isAdmin = userRoles.some((ur) => ur.role.name === 'system:admin');
    }

    // Preview visibility: admins see packages as the target user would; others use session id only
    const previewVisibilityUserId = isAdmin ? user.id : authenticatedUserId;
    const visibleGlobalPlugins = applyVisibilityFilter(isAdmin, previewVisibilityUserId);

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

          // Build plugins from team installs using deployment/package info
          // Filter out installs without valid deployment data
          const teamPlugins = teamPluginInstalls
            .filter(install => install.deployment?.package)
            .map((install, idx) => {
              const memberPref = install.memberAccess?.[0];
              const pkg = install.deployment!.package!;
              const ver = install.deployment!.version;
              // Check user's personal preference first, then team member access, then install default
              const userPref = userPrefsMap.get(pkg.name);
              const isEnabled = userPref !== undefined
                ? userPref.enabled
                : (memberPref ? memberPref.visible : install.enabled);
              const order = userPref?.order ?? idx;
              const isPinned = userPref?.pinned ?? false;
              return {
                installId: install.id,
                id: install.id,
                name: pkg.name || `plugin-${install.id}`,
                displayName: pkg.displayName || pkg.name || 'Unknown Plugin',
                description: pkg.description || '',
                version: ver?.version || '1.0.0',
                remoteUrl: pkg.repository || '',
                routes: [`/plugins/${pkg.name || install.id}/*`],
                enabled: isEnabled,
                order: order,
                pinned: isPinned,
                icon: pkg.icon || undefined,
                isCore: pkg.isCore || isCorePlugin(pkg.name),
                category: pkg.category || 'other',
                metadata: {},
              };
            });

          // Get core plugins from published global plugins (always available in team context)
          const coreGlobalPlugins = visibleGlobalPlugins
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
        const coreGlobalPlugins = visibleGlobalPlugins
          .filter(p => isCorePlugin(p.name))
          .map(plugin => ({ ...plugin, enabled: true, isCore: true }));
        return success({ plugins: [...coreGlobalPlugins, ...headlessPlugins], context: 'team', teamId, error: 'Failed to load team plugins' });
      }

      // User is not a team member - return core plugins + headless providers
      const coreGlobalPlugins = visibleGlobalPlugins
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
    for (const plugin of visibleGlobalPlugins) {
      if (isCorePlugin(plugin.name) && !preferencesMap.has(plugin.name)) {
        corePluginsToAutoInstall.push(plugin.name);
      }
    }
    // Auto-install hidden preview plugins for allowlisted testers (same shape as core prefs)
    const previewPluginsToAutoInstall: string[] = [];
    for (const plugin of visibleGlobalPlugins) {
      if (preferencesMap.has(plugin.name)) continue;
      const norm = normalizePluginName(plugin.name);
      const pkg = publishedPackageByNormalizedName.get(norm);
      if (
        pkg &&
        !pkg.visibleToUsers &&
        pkg.previewTesterUserIds?.includes(user.id)
      ) {
        previewPluginsToAutoInstall.push(plugin.name);
      }
    }
    const prefsToCreate = [...new Set([...corePluginsToAutoInstall, ...previewPluginsToAutoInstall])];
    if (prefsToCreate.length > 0) {
      await prisma.userPluginPreference.createMany({
        data: prefsToCreate.map((pluginName) => ({
          userId: user.id,
          pluginName,
          enabled: true,
          order: 0,
          pinned: false,
        })),
        skipDuplicates: true,
      });
      // Update the local map with the newly created preferences
      for (const pluginName of prefsToCreate) {
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

    // Merge published global plugins with user preferences.
    // Each plugin gets `installed` and `isCore` flags.
    const mergedPlugins = visibleGlobalPlugins
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
