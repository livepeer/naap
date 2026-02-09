/**
 * Personalized Plugins API Route
 * GET /api/v1/base/plugins/personalized - Get user-specific plugins
 *
 * Ports legacy base-svc endpoint to Next.js.
 */

import {NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { validateSession } from '@/lib/api/auth';
import { success, errors, getAuthToken } from '@/lib/api/response';

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

          // Core plugins that should always be available in team context
          const CORE_PLUGIN_NAMES = ['marketplace', 'plugin-publisher', 'pluginpublisher'];
          const normalizePluginName = (name: string) =>
            name.toLowerCase().replace(/[-_]/g, '');

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
                // Include installId for team plugin management (install/uninstall)
                installId: install.id,
                id: install.id, // Also include as 'id' for compatibility
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
                isCore: pkg.isCore || false,
                category: pkg.category || 'other',
                metadata: {},
              };
            });

          // Get core plugins from global plugins (always available)
          const corePlugins = globalPlugins
            .filter(p => CORE_PLUGIN_NAMES.includes(normalizePluginName(p.name)))
            .map(plugin => ({
              ...plugin,
              enabled: true, // Core plugins always enabled in team context
            }));

          // Combine team plugins with core plugins
          const allTeamPlugins = [...teamPlugins, ...corePlugins];

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

          // Return team plugins (which may be empty except for core plugins)
          return success({ plugins: personalizedPlugins, context: 'team', teamId });
        }
      } catch (teamErr) {
        console.warn('Error fetching team plugins:', teamErr);
        // On error, still return only core plugins for team context
        const CORE_PLUGIN_NAMES = ['marketplace', 'plugin-publisher', 'pluginpublisher'];
        const normalizePluginName = (name: string) =>
          name.toLowerCase().replace(/[-_]/g, '');
        const corePlugins = globalPlugins
          .filter(p => CORE_PLUGIN_NAMES.includes(normalizePluginName(p.name)))
          .map(plugin => ({ ...plugin, enabled: true }));
        return success({ plugins: corePlugins, context: 'team', teamId, error: 'Failed to load team plugins' });
      }

      // User is not a team member - return only core plugins for team context
      const CORE_PLUGIN_NAMES = ['marketplace', 'plugin-publisher', 'pluginpublisher'];
      const normalizePluginName = (name: string) =>
        name.toLowerCase().replace(/[-_]/g, '');
      const corePlugins = globalPlugins
        .filter(p => CORE_PLUGIN_NAMES.includes(normalizePluginName(p.name)))
        .map(plugin => ({ ...plugin, enabled: true }));
      return success({ plugins: corePlugins, context: 'team', teamId });
    }

    // Personal context: Get user preferences
    const userPreferences = await prisma.userPluginPreference.findMany({
      where: { userId: user.id },
    });

    const preferencesMap = new Map(
      userPreferences.map((p) => [p.pluginName, p])
    );

    // Merge global plugins with user preferences
    // Note: We return ALL plugins (both enabled and disabled) so the settings page
    // can show toggles for disabled plugins. The sidebar/navigation should filter
    // by enabled status on the frontend.
    const mergedPlugins = globalPlugins
      .map((plugin) => {
        const userPref = preferencesMap.get(plugin.name);
        return {
          ...plugin,
          enabled: userPref ? userPref.enabled : plugin.enabled,
          order: userPref?.order ?? plugin.order,
          pinned: userPref?.pinned ?? false,
        };
      })
      .sort((a, b) => {
        // Pinned items first
        if (a.pinned && !b.pinned) return -1;
        if (!a.pinned && b.pinned) return 1;
        // Then by order
        return a.order - b.order;
      });

    // Deduplicate by normalized name (handle my-wallet vs myWallet, etc.)
    const normalizePluginName = (name: string) => 
      name.toLowerCase().replace(/[-_]/g, '');
    
    const seenNames = new Set<string>();
    const personalizedPlugins = mergedPlugins.filter((plugin) => {
      const normalized = normalizePluginName(plugin.name);
      if (seenNames.has(normalized)) {
        return false;
      }
      seenNames.add(normalized);
      return true;
    });

    return success({ plugins: personalizedPlugins, context: 'personal' });
  } catch (err) {
    console.error('Error fetching personalized plugins:', err);
    return errors.internal('Failed to fetch personalized plugins');
  }
}
