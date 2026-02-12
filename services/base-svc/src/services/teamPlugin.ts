/**
 * Team Plugin Service
 * 
 * Manages team-level plugin installations and member access control.
 * Handles shared and personal config management.
 */

import { PrismaClient, Prisma, TeamPluginInstall, TeamMemberPluginAccess, TeamMemberPluginConfig } from '@naap/database';
import { createLifecycleService } from './lifecycle';
import { getTeamService, TeamRole } from './team';
import { createDeploymentService } from './deployment';
import { validateManifest } from './manifestValidator';

/** Sanitize a value for safe log output (prevents log injection) */
function sanitizeForLog(value: unknown): string {
  return String(value).replace(/[\n\r\t\x00-\x1f\x7f-\x9f]/g, '');
}

/**
 * Deep merge two objects (for config merging)
 * Personal config overrides shared config
 * Note: Defined locally to avoid ESM re-export issues with @naap/types
 */
function deepMerge<T extends Record<string, unknown>>(
  base: T,
  override: Partial<T>
): T {
  const result = { ...base } as T;

  for (const key in override) {
    if (Object.prototype.hasOwnProperty.call(override, key)) {
      const baseValue = base[key];
      const overrideValue = override[key];

      if (
        overrideValue !== undefined &&
        overrideValue !== null &&
        typeof baseValue === 'object' &&
        typeof overrideValue === 'object' &&
        !Array.isArray(baseValue) &&
        !Array.isArray(overrideValue)
      ) {
        // Recursively merge objects
        (result as Record<string, unknown>)[key] = deepMerge(
          baseValue as Record<string, unknown>,
          overrideValue as Record<string, unknown>
        );
      } else if (overrideValue !== undefined) {
        // Override primitive values and arrays
        (result as Record<string, unknown>)[key] = overrideValue;
      }
    }
  }

  return result;
}

/**
 * Deep merge config objects with special handling for null values
 * null in personal config explicitly removes the shared config value
 */
function deepMergeConfig(
  shared: Record<string, unknown>,
  personal: Record<string, unknown>
): Record<string, unknown> {
  const result = deepMerge(shared, personal);

  // Handle explicit null values (removes from result)
  for (const key in personal) {
    if (personal[key] === null) {
      delete result[key];
    }
  }

  return result;
}

export interface TeamPluginAccessInput {
  visible?: boolean;
  canUse?: boolean;
  canConfigure?: boolean;
  pluginRole?: string | null;
}

export interface TeamPluginInstallWithDetails extends TeamPluginInstall {
  deployment: {
    id: string;
    package: {
      id: string;
      name: string;
      displayName: string;
      description: string | null;
      icon: string | null;
    };
    version: {
      id: string;
      version: string;
    };
    frontendUrl: string | null;
    backendUrl: string | null;
    status: string;
  };
  _count: {
    memberAccess: number;
  };
}

export interface MemberPluginAccessWithDetails extends TeamMemberPluginAccess {
  pluginInstall: {
    id: string;
    sharedConfig: unknown;
    deployment: {
      id: string;
      frontendUrl: string | null;
      backendUrl: string | null;
      package: {
        name: string;
        displayName: string;
        icon: string | null;
        isCore?: boolean;
      };
    };
  };
  personalConfig?: {
    personalConfig: unknown;
  } | null;
}

export function createTeamPluginService(prisma: PrismaClient) {
  const lifecycleService = createLifecycleService(prisma);
  const teamService = getTeamService(prisma);
  const deploymentService = createDeploymentService(prisma);

  return {
    /**
     * Install a plugin for a team
     *
     * Uses a transaction to ensure atomicity:
     * - Create TeamPluginInstall
     * - Increment activeInstalls counter
     * - Grant access to all team members
     *
     * If any step fails, the entire operation is rolled back.
     */
    async installPlugin(
      teamId: string,
      packageName: string,
      userId: string
    ): Promise<TeamPluginInstall> {
      // Check permission before starting transaction
      const hasPermission = await teamService.hasTeamPermission(userId, teamId, 'plugins.install');
      if (!hasPermission) {
        throw new Error('Permission denied: cannot install plugins');
      }

      // Get the package and its deployment
      const pkg = await prisma.pluginPackage.findUnique({
        where: { name: packageName },
        include: {
          deployment: true,
          versions: {
            orderBy: { publishedAt: 'desc' },
            take: 1,
          },
        },
      });

      if (!pkg) {
        throw new Error('Plugin package not found');
      }

      // Ensure deployment exists (lazy deployment)
      const latestVersion = pkg.versions[0];
      if (!latestVersion) {
        throw new Error('No published version available');
      }

      // Validate manifest before proceeding (security check)
      if (latestVersion.manifest) {
        const validation = validateManifest(latestVersion.manifest);
        if (!validation.valid) {
          const errorMessages = validation.errors.map(e => `${e.field}: ${e.message}`).join('; ');
          throw new Error(`Invalid plugin manifest: ${errorMessages}`);
        }
        // Log warnings but don't block installation
        if (validation.warnings.length > 0) {
          console.warn(`Plugin "${sanitizeForLog(packageName)}" has manifest warnings:`, validation.warnings);
        }
      }

      const { deployment } = await deploymentService.getOrCreateDeployment(pkg.id, latestVersion.id);

      // Check if already installed for this team
      const existing = await prisma.teamPluginInstall.findUnique({
        where: {
          teamId_deploymentId: { teamId, deploymentId: deployment.id },
        },
      });

      if (existing) {
        throw new Error('Plugin already installed for this team');
      }

      // Get team members before transaction for access grants
      const members = await prisma.teamMember.findMany({
        where: { teamId },
      });

      // Use transaction to ensure atomicity
      const install = await prisma.$transaction(async (tx) => {
        // Create team plugin installation
        const newInstall = await tx.teamPluginInstall.create({
          data: {
            teamId,
            deploymentId: deployment.id,
            installedBy: userId,
            status: 'active',
            enabled: true,
          },
        });

        // Increment active installs count atomically within transaction
        await tx.pluginDeployment.update({
          where: { id: deployment.id },
          data: { activeInstalls: { increment: 1 } },
        });

        // Grant default access to all team members
        if (members.length > 0) {
          await tx.teamMemberPluginAccess.createMany({
            data: members.map((member) => ({
              memberId: member.id,
              pluginInstallId: newInstall.id,
              visible: true,
              canUse: true,
              canConfigure: member.role === 'owner' || member.role === 'admin',
            })),
          });
        }

        return newInstall;
      });

      // Audit log outside transaction (non-critical)
      await lifecycleService.audit({
        action: 'team.plugin.install',
        resource: 'teamPluginInstall',
        resourceId: install.id,
        userId,
        details: { teamId, packageName },
      }).catch((err) => {
        console.error('Failed to create audit log for plugin install:', err);
      });

      return install;
    },

    /**
     * Uninstall a plugin from a team
     */
    async uninstallPlugin(installId: string, userId: string): Promise<void> {
      const install = await prisma.teamPluginInstall.findUnique({
        where: { id: installId },
        include: { 
          deployment: {
            include: {
              package: {
                select: { isCore: true, name: true },
              },
            },
          },
        },
      });

      if (!install) {
        throw new Error('Plugin installation not found');
      }

      // Prevent uninstallation of core plugins
      if (install.deployment.package?.isCore) {
        throw new Error('Cannot uninstall core plugins. Core plugins are always available and required for team functionality.');
      }

      // Check permission
      const hasPermission = await teamService.hasTeamPermission(userId, install.teamId, 'plugins.uninstall');
      if (!hasPermission) {
        throw new Error('Permission denied: cannot uninstall plugins');
      }

      // Delete the installation (cascades to access and config)
      await prisma.teamPluginInstall.delete({
        where: { id: installId },
      });

      // Decrement active installs count
      await prisma.pluginDeployment.update({
        where: { id: install.deploymentId },
        data: { activeInstalls: { decrement: 1 } },
      });

      await lifecycleService.audit({
        action: 'team.plugin.uninstall',
        resource: 'teamPluginInstall',
        resourceId: installId,
        userId,
        details: { teamId: install.teamId },
      });
    },

    /**
     * Get all plugins installed for a team
     */
    async getTeamPlugins(teamId: string): Promise<TeamPluginInstallWithDetails[]> {
      return prisma.teamPluginInstall.findMany({
        where: { teamId },
        include: {
          deployment: {
            include: {
              package: {
                select: {
                  id: true,
                  name: true,
                  displayName: true,
                  description: true,
                  icon: true,
                  isCore: true,
                },
              },
              version: {
                select: {
                  id: true,
                  version: true,
                },
              },
            },
          },
          _count: {
            select: { memberAccess: true },
          },
        },
        orderBy: { createdAt: 'asc' },
      });
    },

    /**
     * Update shared config for a team plugin
     */
    async updateSharedConfig(
      installId: string,
      config: Record<string, unknown>,
      userId: string
    ): Promise<TeamPluginInstall> {
      const install = await prisma.teamPluginInstall.findUnique({
        where: { id: installId },
      });

      if (!install) {
        throw new Error('Plugin installation not found');
      }

      // Only owner can update shared config
      const role = await teamService.getUserTeamRole(userId, install.teamId);
      if (role !== 'owner') {
        throw new Error('Permission denied: only owner can update shared config');
      }

      const updated = await prisma.teamPluginInstall.update({
        where: { id: installId },
        data: { sharedConfig: config as Prisma.InputJsonValue },
      });

      await lifecycleService.audit({
        action: 'team.plugin.config.shared.update',
        resource: 'teamPluginInstall',
        resourceId: installId,
        userId,
        details: { teamId: install.teamId },
      });

      return updated;
    },

    /**
     * Toggle plugin enabled status
     */
    async togglePluginEnabled(
      installId: string,
      enabled: boolean,
      userId: string
    ): Promise<TeamPluginInstall> {
      const install = await prisma.teamPluginInstall.findUnique({
        where: { id: installId },
      });

      if (!install) {
        throw new Error('Plugin installation not found');
      }

      const hasPermission = await teamService.hasTeamPermission(userId, install.teamId, 'plugins.configure');
      if (!hasPermission) {
        throw new Error('Permission denied: cannot configure plugins');
      }

      return prisma.teamPluginInstall.update({
        where: { id: installId },
        data: { enabled },
      });
    },

    /**
     * Get a member's plugin access settings
     */
    async getMemberAccess(memberId: string): Promise<MemberPluginAccessWithDetails[]> {
      return prisma.teamMemberPluginAccess.findMany({
        where: { memberId },
        include: {
          pluginInstall: {
            include: {
              deployment: {
                include: {
                  package: {
                    select: {
                      name: true,
                      displayName: true,
                      icon: true,
                      isCore: true,
                    },
                  },
                },
              },
            },
          },
        },
      });
    },

    /**
     * Set access for a specific member to a plugin
     */
    async setMemberAccess(
      memberId: string,
      pluginInstallId: string,
      access: TeamPluginAccessInput,
      updaterId: string
    ): Promise<TeamMemberPluginAccess> {
      const member = await prisma.teamMember.findUnique({
        where: { id: memberId },
      });

      if (!member) {
        throw new Error('Team member not found');
      }

      // Check updater has permission
      const hasPermission = await teamService.hasTeamPermission(updaterId, member.teamId, 'access.manage');
      if (!hasPermission) {
        throw new Error('Permission denied: cannot manage access');
      }

      // Cannot modify owner's access
      if (member.role === 'owner') {
        throw new Error('Cannot modify owner access');
      }

      // Upsert the access record
      const accessRecord = await prisma.teamMemberPluginAccess.upsert({
        where: {
          memberId_pluginInstallId: { memberId, pluginInstallId },
        },
        create: {
          memberId,
          pluginInstallId,
          visible: access.visible ?? true,
          canUse: access.canUse ?? true,
          canConfigure: access.canConfigure ?? false,
          pluginRole: access.pluginRole,
        },
        update: {
          visible: access.visible,
          canUse: access.canUse,
          canConfigure: access.canConfigure,
          pluginRole: access.pluginRole,
        },
      });

      await lifecycleService.audit({
        action: 'team.member.access.update',
        resource: 'teamMemberPluginAccess',
        resourceId: accessRecord.id,
        userId: updaterId,
        details: { memberId, pluginInstallId, access },
      });

      return accessRecord;
    },

    /**
     * Update a member's own plugin visibility (self-service)
     * Members can control their own visibility without admin permission
     */
    async updateMemberAccess(
      memberId: string,
      pluginInstallId: string,
      update: { visible?: boolean }
    ): Promise<TeamMemberPluginAccess> {
      // Check if access record exists
      const existing = await prisma.teamMemberPluginAccess.findUnique({
        where: {
          memberId_pluginInstallId: { memberId, pluginInstallId },
        },
      });

      if (!existing) {
        throw new Error('Plugin access not found');
      }

      // Update only visibility - members can hide plugins from their view
      const accessRecord = await prisma.teamMemberPluginAccess.update({
        where: {
          memberId_pluginInstallId: { memberId, pluginInstallId },
        },
        data: {
          visible: update.visible ?? existing.visible,
        },
      });

      return accessRecord;
    },

    /**
     * Update personal config for a member
     */
    async updatePersonalConfig(
      memberId: string,
      pluginInstallId: string,
      config: Record<string, unknown>,
      userId: string
    ): Promise<TeamMemberPluginConfig> {
      const member = await prisma.teamMember.findUnique({
        where: { id: memberId },
        include: {
          pluginAccess: {
            where: { pluginInstallId },
          },
        },
      });

      if (!member) {
        throw new Error('Team member not found');
      }

      // User can only update their own personal config
      if (member.userId !== userId) {
        throw new Error('Can only update your own personal config');
      }

      // Check if member has configure permission
      const access = member.pluginAccess[0];
      if (!access?.canConfigure) {
        throw new Error('Permission denied: cannot configure this plugin');
      }

      // Upsert personal config
      const configRecord = await prisma.teamMemberPluginConfig.upsert({
        where: {
          memberId_pluginInstallId: { memberId, pluginInstallId },
        },
        create: {
          memberId,
          pluginInstallId,
          personalConfig: config as Prisma.InputJsonValue,
        },
        update: {
          personalConfig: config as Prisma.InputJsonValue,
        },
      });

      await lifecycleService.audit({
        action: 'team.member.config.update',
        resource: 'teamMemberPluginConfig',
        resourceId: configRecord.id,
        userId,
        details: { pluginInstallId },
      });

      return configRecord;
    },

    /**
     * Get merged config for a member (shared + personal)
     * Uses deep merge to properly handle nested objects
     */
    async getMergedConfig(
      memberId: string,
      pluginInstallId: string
    ): Promise<Record<string, unknown>> {
      const install = await prisma.teamPluginInstall.findUnique({
        where: { id: pluginInstallId },
      });

      if (!install) {
        throw new Error('Plugin installation not found');
      }

      const personalConfig = await prisma.teamMemberPluginConfig.findUnique({
        where: {
          memberId_pluginInstallId: { memberId, pluginInstallId },
        },
      });

      // Merge: personal overrides shared (deep merge for nested objects)
      const sharedConfig = (install.sharedConfig as Record<string, unknown>) || {};
      const personal = (personalConfig?.personalConfig as Record<string, unknown>) || {};

      return deepMergeConfig(sharedConfig, personal);
    },

    /**
     * Get plugins accessible to a user in a team context
     * This includes:
     * 1. Plugins explicitly installed for the team that the user has access to
     * 2. Core plugins (isCore=true) that are always available regardless of installation
     */
    async getUserAccessiblePlugins(
      userId: string,
      teamId: string
    ): Promise<MemberPluginAccessWithDetails[]> {
      const member = await prisma.teamMember.findUnique({
        where: { teamId_userId: { teamId, userId } },
      });

      if (!member) {
        return [];
      }

      // Get team-installed plugins user has access to
      const teamPlugins = await prisma.teamMemberPluginAccess.findMany({
        where: {
          memberId: member.id,
          visible: true,
          canUse: true,
          pluginInstall: {
            enabled: true,
          },
        },
        include: {
          pluginInstall: {
            include: {
              deployment: {
                include: {
                  package: {
                    select: {
                      name: true,
                      displayName: true,
                      icon: true,
                      isCore: true,
                    },
                  },
                },
              },
            },
          },
        },
      });

      // Get core plugins not already in team plugins
      const installedPackageNames = new Set(
        teamPlugins.map(p => p.pluginInstall.deployment.package.name)
      );

      const corePlugins = await prisma.pluginPackage.findMany({
        where: {
          isCore: true,
          name: { notIn: Array.from(installedPackageNames) },
        },
        include: {
          deployment: {
            include: {
              version: true,
            },
          },
        },
      });

      // Transform core plugins to match MemberPluginAccessWithDetails format
      const corePluginAccess: MemberPluginAccessWithDetails[] = corePlugins
        .filter(pkg => pkg.deployment) // Only include core plugins with deployment
        .map(pkg => ({
          id: `core-${pkg.name}`,
          memberId: member.id,
          pluginInstallId: `core-${pkg.name}`,
          visible: true,
          canUse: true,
          canConfigure: false,
          pluginRole: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          pluginInstall: {
            id: `core-${pkg.name}`,
            teamId,
            deploymentId: pkg.deployment!.id,
            installedBy: 'system',
            status: 'active',
            enabled: true,
            sharedConfig: null,
            createdAt: pkg.createdAt,
            updatedAt: pkg.updatedAt,
            deployment: {
              id: pkg.deployment!.id,
              packageId: pkg.id,
              versionId: pkg.deployment!.versionId,
              status: pkg.deployment!.status,
              frontendUrl: pkg.deployment!.frontendUrl,
              backendUrl: pkg.deployment!.backendUrl,
              activeInstalls: pkg.deployment!.activeInstalls,
              createdAt: pkg.deployment!.createdAt,
              updatedAt: pkg.deployment!.updatedAt,
              package: {
                name: pkg.name,
                displayName: pkg.displayName,
                icon: pkg.icon,
                isCore: true,
              },
            },
          },
        }));

      // Merge team plugins with core plugins
      return [...teamPlugins, ...corePluginAccess];
    },

    /**
     * Ensure new team members get default access to all team plugins
     */
    async grantDefaultAccessToMember(memberId: string, teamId: string): Promise<void> {
      const member = await prisma.teamMember.findUnique({
        where: { id: memberId },
      });

      if (!member) {
        throw new Error('Team member not found');
      }

      const plugins = await prisma.teamPluginInstall.findMany({
        where: { teamId },
      });

      // Create access records for all plugins
      await prisma.teamMemberPluginAccess.createMany({
        data: plugins.map((plugin) => ({
          memberId,
          pluginInstallId: plugin.id,
          visible: true,
          canUse: true,
          canConfigure: member.role === 'owner' || member.role === 'admin',
        })),
        skipDuplicates: true,
      });
    },

    // ============================================
    // Version Pinning (Phase 7: Production Feature)
    // ============================================

    /**
     * Pin a plugin to a specific version
     * Prevents auto-upgrade to newer versions
     */
    async pinVersion(
      installId: string,
      versionId: string,
      userId: string,
      teamId: string
    ): Promise<void> {
      // Verify user has permission
      const member = await prisma.teamMember.findUnique({
        where: { teamId_userId: { teamId, userId } },
      });

      if (!member || (member.role !== 'owner' && member.role !== 'admin')) {
        throw new Error('Permission denied: only admins can pin versions');
      }

      // Verify version exists
      const version = await prisma.pluginVersion.findUnique({
        where: { id: versionId },
        include: { package: true },
      });

      if (!version) {
        throw new Error('Plugin version not found');
      }

      // Update the installation with pinned version
      await prisma.teamPluginInstall.update({
        where: { id: installId },
        data: { pinnedVersionId: versionId },
      });

      await lifecycleService.audit({
        action: 'team.plugin.version.pin',
        resource: 'teamPluginInstall',
        resourceId: installId,
        userId,
        details: {
          teamId,
          versionId,
          version: version.version,
          packageName: version.package.name,
        },
      });
    },

    /**
     * Unpin a plugin version (allow auto-upgrade)
     */
    async unpinVersion(
      installId: string,
      userId: string,
      teamId: string
    ): Promise<void> {
      // Verify user has permission
      const member = await prisma.teamMember.findUnique({
        where: { teamId_userId: { teamId, userId } },
      });

      if (!member || (member.role !== 'owner' && member.role !== 'admin')) {
        throw new Error('Permission denied: only admins can unpin versions');
      }

      // Clear the pinned version
      await prisma.teamPluginInstall.update({
        where: { id: installId },
        data: { pinnedVersionId: null },
      });

      await lifecycleService.audit({
        action: 'team.plugin.version.unpin',
        resource: 'teamPluginInstall',
        resourceId: installId,
        userId,
        details: { teamId },
      });
    },

    /**
     * Get available versions for a plugin installation
     */
    async getAvailableVersions(installId: string): Promise<Array<{
      id: string;
      version: string;
      publishedAt: Date;
      releaseNotes: string | null;
      isPinned: boolean;
      isCurrent: boolean;
    }>> {
      const install = await prisma.teamPluginInstall.findUnique({
        where: { id: installId },
        include: {
          deployment: {
            include: {
              package: true,
              version: true,
            },
          },
          pinnedVersion: true,
        },
      });

      if (!install) {
        throw new Error('Plugin installation not found');
      }

      const versions = await prisma.pluginVersion.findMany({
        where: {
          packageId: install.deployment.package.id,
          deprecated: false,
        },
        orderBy: { publishedAt: 'desc' },
      });

      return versions.map((v) => ({
        id: v.id,
        version: v.version,
        publishedAt: v.publishedAt,
        releaseNotes: v.releaseNotes,
        isPinned: install.pinnedVersionId === v.id,
        isCurrent: install.deployment.versionId === v.id,
      }));
    },
  };
}

// Singleton for service reuse
let teamPluginServiceInstance: ReturnType<typeof createTeamPluginService> | null = null;

export function getTeamPluginService(prisma: PrismaClient) {
  if (!teamPluginServiceInstance) {
    teamPluginServiceInstance = createTeamPluginService(prisma);
  }
  return teamPluginServiceInstance;
}
