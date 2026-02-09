/**
 * Plugin Lifecycle Service
 * 
 * Manages the lifecycle of plugins: install, upgrade, uninstall, enable, disable.
 * Provides audit logging for all lifecycle events.
 */

import { PrismaClient } from '@naap/database';

export type LifecycleAction = 'install' | 'upgrade' | 'uninstall' | 'enable' | 'disable' | 'rollback' | 'tenant_install' | 'tenant_uninstall';
export type LifecycleStatus = 'pending' | 'installing' | 'installed' | 'failed' | 'uninstalling' | 'rolledback' | 'upgrading';

export interface LifecycleEventInput {
  pluginName: string;
  version?: string;
  action: LifecycleAction;
  fromStatus?: string;
  toStatus: string;
  initiatedBy?: string;
  details?: Record<string, unknown>;
  error?: string;
  duration?: number;
}

export interface AuditLogInput {
  action: string;
  resource: string;
  resourceId?: string;
  userId?: string;
  ipAddress?: string;
  userAgent?: string;
  details?: Record<string, unknown>;
  status?: 'success' | 'failure';
  errorMsg?: string;
}

// Plugin RBAC types for role registration
export interface PluginRBACRole {
  name: string;
  displayName: string;
  description?: string;
  permissions: Array<{
    resource: string;
    action: 'create' | 'read' | 'update' | 'delete' | 'admin' | '*';
  }>;
  inherits?: string[];
}

export interface PluginRBAC {
  roles?: PluginRBACRole[];
}

// Plugin lifecycle hooks
export interface PluginHooks {
  postInstall?: string;
  preUpdate?: string;
  postUpdate?: string;
  preUninstall?: string;
}

export function createLifecycleService(prisma: PrismaClient) {
  return {
    /**
     * Record a lifecycle event
     */
    async recordEvent(input: LifecycleEventInput) {
      return prisma.pluginLifecycleEvent.create({
        data: {
          pluginName: input.pluginName,
          version: input.version,
          action: input.action,
          fromStatus: input.fromStatus,
          toStatus: input.toStatus,
          initiatedBy: input.initiatedBy,
          details: input.details as object,
          error: input.error,
          duration: input.duration,
        },
      });
    },

    /**
     * Get lifecycle events for a plugin
     */
    async getPluginEvents(pluginName: string, limit = 50) {
      return prisma.pluginLifecycleEvent.findMany({
        where: { pluginName },
        orderBy: { createdAt: 'desc' },
        take: limit,
      });
    },

    /**
     * Get recent lifecycle events across all plugins
     */
    async getRecentEvents(limit = 100) {
      return prisma.pluginLifecycleEvent.findMany({
        orderBy: { createdAt: 'desc' },
        take: limit,
      });
    },

    /**
     * Record an audit log entry
     */
    async audit(input: AuditLogInput) {
      return prisma.auditLog.create({
        data: {
          action: input.action,
          resource: input.resource,
          resourceId: input.resourceId,
          userId: input.userId,
          ipAddress: input.ipAddress,
          userAgent: input.userAgent,
          details: input.details as object,
          status: input.status || 'success',
          errorMsg: input.errorMsg,
        },
      });
    },

    /**
     * Get audit logs with filters
     */
    async getAuditLogs(options: {
      resource?: string;
      resourceId?: string;
      userId?: string;
      action?: string;
      limit?: number;
      since?: Date;
    }) {
      const where: Record<string, unknown> = {};
      
      if (options.resource) where.resource = options.resource;
      if (options.resourceId) where.resourceId = options.resourceId;
      if (options.userId) where.userId = options.userId;
      if (options.action) where.action = options.action;
      if (options.since) {
        where.createdAt = { gte: options.since };
      }

      return prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: options.limit || 100,
      });
    },

    /**
     * Install a plugin
     */
    async installPlugin(
      packageId: string,
      versionId: string,
      initiatedBy?: string
    ) {
      const startTime = Date.now();
      
      // Get package and version details
      const pkg = await prisma.pluginPackage.findUnique({
        where: { id: packageId },
      });
      
      const version = await prisma.pluginVersion.findUnique({
        where: { id: versionId },
      });

      if (!pkg || !version) {
        throw new Error('Package or version not found');
      }

      // Check if already installed
      const existing = await prisma.pluginInstallation.findUnique({
        where: { packageId },
      });

      if (existing && existing.status === 'installed') {
        throw new Error('Plugin is already installed');
      }

      try {
        // Create or update installation record
        const installation = await prisma.pluginInstallation.upsert({
          where: { packageId },
          create: {
            packageId,
            versionId,
            status: 'installing',
          },
          update: {
            versionId,
            status: 'installing',
          },
        });

        // Record lifecycle event
        await this.recordEvent({
          pluginName: pkg.name,
          version: version.version,
          action: 'install',
          fromStatus: existing?.status,
          toStatus: 'installing',
          initiatedBy,
        });

        // Parse manifest from version
        const manifest = version.manifest as { 
          routes?: string[]; 
          icon?: string;
          rbac?: PluginRBAC;
          hooks?: PluginHooks;
        };

        // Execute installation logic:
        // - Pull Docker image if backend
        // - Create database if needed  
        // - Register with CDN plugin system
        // - Execute postInstall hook
        // Note: Full implementation requires infrastructure-svc integration
        
        // Execute postInstall hook if defined
        if (manifest.hooks?.postInstall) {
          const { executeLifecycleHook } = await import('./hookExecutor.js');
          const hookResult = await executeLifecycleHook(
            manifest.hooks,
            'postInstall',
            {
              pluginName: pkg.name,
              version: version.version,
              action: 'install',
              environment: {
                PLUGIN_ID: packageId,
                VERSION_ID: versionId,
                BACKEND_URL: version.frontendUrl || '', // Note: version.backendUrl not in schema
                FRONTEND_URL: version.frontendUrl || '',
              },
            },
            { timeout: 300000 } // 5 minutes
          );

          if (hookResult && !hookResult.success) {
            throw new Error(`postInstall hook failed: ${hookResult.error}`);
          }
        }

        // Update to installed
        await prisma.pluginInstallation.update({
          where: { id: installation.id },
          data: {
            status: 'installed',
            installedAt: new Date(),
          },
        });

        // Also create/update WorkflowPlugin for frontend loading
        await prisma.workflowPlugin.upsert({
          where: { name: pkg.name },
          create: {
            name: pkg.name,
            displayName: pkg.displayName,
            version: version.version,
            remoteUrl: version.frontendUrl || '',
            routes: manifest.routes || [`/${pkg.name}`],
            enabled: true,
            icon: pkg.icon,
          },
          update: {
            displayName: pkg.displayName,
            version: version.version,
            remoteUrl: version.frontendUrl || '',
            routes: manifest.routes || [`/${pkg.name}`],
            enabled: true,
            icon: pkg.icon,
          },
        });

        // Register plugin-contributed roles if defined
        if (manifest.rbac) {
          await this.registerPluginRoles(pkg.name, manifest.rbac);
        }

        const duration = Date.now() - startTime;

        // Record success
        await this.recordEvent({
          pluginName: pkg.name,
          version: version.version,
          action: 'install',
          fromStatus: 'installing',
          toStatus: 'installed',
          initiatedBy,
          duration,
        });

        // Audit log
        await this.audit({
          action: 'plugin.install',
          resource: 'plugin',
          resourceId: pkg.name,
          userId: initiatedBy,
          details: { version: version.version },
        });

        return { success: true, installation };
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        const duration = Date.now() - startTime;

        // Update status to failed
        await prisma.pluginInstallation.update({
          where: { packageId },
          data: { status: 'failed' },
        });

        // Record failure
        await this.recordEvent({
          pluginName: pkg.name,
          version: version.version,
          action: 'install',
          fromStatus: 'installing',
          toStatus: 'failed',
          initiatedBy,
          error: errorMsg,
          duration,
        });

        throw error;
      }
    },

    /**
     * Uninstall a plugin
     */
    async uninstallPlugin(packageId: string, initiatedBy?: string) {
      const startTime = Date.now();

      const installation = await prisma.pluginInstallation.findUnique({
        where: { packageId },
        include: { package: true, version: true },
      });

      if (!installation) {
        throw new Error('Plugin is not installed');
      }

      const pluginName = installation.package.name;
      const version = installation.version.version;

      try {
        // Update status
        await prisma.pluginInstallation.update({
          where: { packageId },
          data: { status: 'uninstalling' },
        });

        await this.recordEvent({
          pluginName,
          version,
          action: 'uninstall',
          fromStatus: installation.status,
          toStatus: 'uninstalling',
          initiatedBy,
        });

        // Here would be cleanup logic:
        // - Stop and remove Docker container
        // - Drop database if needed
        // - Unregister from CDN plugin system

        // Delete installation record
        await prisma.pluginInstallation.delete({
          where: { packageId },
        });

        // Disable the WorkflowPlugin
        await prisma.workflowPlugin.updateMany({
          where: { name: pluginName },
          data: { enabled: false },
        });

        // Unregister plugin-contributed roles
        await this.unregisterPluginRoles(pluginName);

        const duration = Date.now() - startTime;

        await this.recordEvent({
          pluginName,
          version,
          action: 'uninstall',
          fromStatus: 'uninstalling',
          toStatus: 'uninstalled',
          initiatedBy,
          duration,
        });

        await this.audit({
          action: 'plugin.uninstall',
          resource: 'plugin',
          resourceId: pluginName,
          userId: initiatedBy,
          details: { version },
        });

        return { success: true };
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        const duration = Date.now() - startTime;

        await this.recordEvent({
          pluginName,
          version,
          action: 'uninstall',
          fromStatus: 'uninstalling',
          toStatus: 'failed',
          initiatedBy,
          error: errorMsg,
          duration,
        });

        throw error;
      }
    },

    /**
     * Enable a plugin
     */
    async enablePlugin(pluginName: string, initiatedBy?: string) {
      const plugin = await prisma.workflowPlugin.findUnique({
        where: { name: pluginName },
      });

      if (!plugin) {
        throw new Error('Plugin not found');
      }

      await prisma.workflowPlugin.update({
        where: { name: pluginName },
        data: { enabled: true },
      });

      await this.recordEvent({
        pluginName,
        version: plugin.version,
        action: 'enable',
        fromStatus: 'disabled',
        toStatus: 'enabled',
        initiatedBy,
      });

      await this.audit({
        action: 'plugin.enable',
        resource: 'plugin',
        resourceId: pluginName,
        userId: initiatedBy,
      });

      return { success: true };
    },

    /**
     * Disable a plugin
     */
    async disablePlugin(pluginName: string, initiatedBy?: string) {
      const plugin = await prisma.workflowPlugin.findUnique({
        where: { name: pluginName },
      });

      if (!plugin) {
        throw new Error('Plugin not found');
      }

      await prisma.workflowPlugin.update({
        where: { name: pluginName },
        data: { enabled: false },
      });

      await this.recordEvent({
        pluginName,
        version: plugin.version,
        action: 'disable',
        fromStatus: 'enabled',
        toStatus: 'disabled',
        initiatedBy,
      });

      await this.audit({
        action: 'plugin.disable',
        resource: 'plugin',
        resourceId: pluginName,
        userId: initiatedBy,
      });

      return { success: true };
    },

    /**
     * Upgrade a plugin to a new version
     */
    async upgradePlugin(
      packageId: string,
      newVersionId: string,
      initiatedBy?: string
    ) {
      const startTime = Date.now();

      const installation = await prisma.pluginInstallation.findUnique({
        where: { packageId },
        include: { package: true, version: true },
      });

      if (!installation || installation.status !== 'installed') {
        throw new Error('Plugin is not installed');
      }

      const newVersion = await prisma.pluginVersion.findUnique({
        where: { id: newVersionId },
      });

      if (!newVersion) {
        throw new Error('Target version not found');
      }

      const pluginName = installation.package.name;
      const oldVersion = installation.version.version;

      try {
        // Update status
        await prisma.pluginInstallation.update({
          where: { packageId },
          data: { status: 'upgrading' },
        });

        await this.recordEvent({
          pluginName,
          version: newVersion.version,
          action: 'upgrade',
          fromStatus: `installed@${oldVersion}`,
          toStatus: 'upgrading',
          initiatedBy,
          details: { fromVersion: oldVersion },
        });

        // Here would be upgrade logic:
        // - Pull new Docker image
        // - Run migrations
        // - Update CDN plugin bundle

        // Update installation
        await prisma.pluginInstallation.update({
          where: { packageId },
          data: {
            versionId: newVersionId,
            status: 'installed',
            installedAt: new Date(),
          },
        });

        // Update WorkflowPlugin
        const manifest = newVersion.manifest as { routes?: string[] };
        await prisma.workflowPlugin.update({
          where: { name: pluginName },
          data: {
            version: newVersion.version,
            remoteUrl: newVersion.frontendUrl || '',
            routes: manifest.routes || [`/${pluginName}`],
          },
        });

        const duration = Date.now() - startTime;

        await this.recordEvent({
          pluginName,
          version: newVersion.version,
          action: 'upgrade',
          fromStatus: 'upgrading',
          toStatus: 'installed',
          initiatedBy,
          duration,
          details: { fromVersion: oldVersion },
        });

        await this.audit({
          action: 'plugin.upgrade',
          resource: 'plugin',
          resourceId: pluginName,
          userId: initiatedBy,
          details: { fromVersion: oldVersion, toVersion: newVersion.version },
        });

        return { success: true };
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        const duration = Date.now() - startTime;

        // Rollback to previous version
        await prisma.pluginInstallation.update({
          where: { packageId },
          data: {
            versionId: installation.versionId,
            status: 'rolledback',
          },
        });

        await this.recordEvent({
          pluginName,
          version: newVersion.version,
          action: 'rollback',
          fromStatus: 'upgrading',
          toStatus: 'rolledback',
          initiatedBy,
          error: errorMsg,
          duration,
          details: { rolledBackTo: oldVersion },
        });

        throw error;
      }
    },

    /**
     * Register roles from plugin manifest
     * Creates plugin:admin role automatically and any plugin-defined roles
     */
    async registerPluginRoles(pluginName: string, rbac: PluginRBAC) {
      // 1. Always create the plugin admin role
      const adminRoleName = `${pluginName}:admin`;

      await prisma.role.upsert({
        where: { name: adminRoleName },
        create: {
          name: adminRoleName,
          displayName: `${pluginName} Administrator`,
          description: `Full access to ${pluginName} plugin`,
          permissions: [{ resource: `${pluginName}:*`, action: '*' }] as object,
          canAssign: [`${pluginName}:*`], // Can assign any role in this plugin
          scope: 'plugin',
          pluginName,
        },
        update: {}, // Don't overwrite if exists
      });

      // 2. Register plugin-defined roles
      for (const role of rbac.roles || []) {
        const fullName = `${pluginName}:${role.name}`;
        await prisma.role.upsert({
          where: { name: fullName },
          create: {
            name: fullName,
            displayName: role.displayName,
            description: role.description,
            permissions: role.permissions.map((p) => ({
              ...p,
              // Prefix resources with plugin name for isolation
              resource: `${pluginName}:${p.resource}`,
            })) as object,
            canAssign: [], // Regular roles cannot assign
            inherits: role.inherits?.map((r) => `${pluginName}:${r}`),
            scope: 'plugin',
            pluginName,
          },
          update: {},
        });
      }

      // Audit the role registration
      await this.audit({
        action: 'plugin.roles.registered',
        resource: 'plugin',
        resourceId: pluginName,
        details: { roleCount: (rbac.roles?.length || 0) + 1 },
      });
    },

    /**
     * Unregister plugin roles when plugin is uninstalled
     */
    async unregisterPluginRoles(pluginName: string) {
      // Delete all roles for this plugin
      await prisma.role.deleteMany({
        where: { pluginName },
      });

      await this.audit({
        action: 'plugin.roles.unregistered',
        resource: 'plugin',
        resourceId: pluginName,
      });
    },
  };
}
