/**
 * Tenant Service
 * Handles multi-tenant plugin installations with virtual install/uninstall and config management
 */

import { PrismaClient, Prisma } from '@naap/database';
import { getEncryptionService } from './encryption';

export interface TenantInstallResult {
  id: string;
  userId: string;
  deploymentId: string;
  status: string;
  enabled: boolean;
  order: number;
  pinned: boolean;
  installedAt: Date;
  config?: {
    settings: Record<string, unknown>;
  };
  deployment: {
    id: string;
    packageId: string;
    versionId: string;
    status: string;
    frontendUrl: string | null;
    backendUrl: string | null;
    healthStatus: string | null;
    package: {
      name: string;
      displayName: string;
      icon: string | null;
      category: string;
    };
    version: {
      version: string;
      manifest: unknown;
    };
  };
}

export interface TenantConfig {
  settings: Record<string, unknown>;
  secrets?: Record<string, unknown>;
}

export function createTenantService(prisma: PrismaClient) {
  return {
    /**
     * List all virtual installations for a user
     */
    async listUserInstallations(userId: string): Promise<TenantInstallResult[]> {
      const installs = await prisma.tenantPluginInstall.findMany({
        where: {
          userId,
          status: { not: 'uninstalled' },
        },
        include: {
          deployment: {
            include: {
              package: true,
              version: true,
            },
          },
          config: true,
        },
        orderBy: [
          { pinned: 'desc' },
          { order: 'asc' },
          { installedAt: 'asc' },
        ],
      });

      return installs.map((install) => ({
        id: install.id,
        userId: install.userId,
        deploymentId: install.deploymentId,
        status: install.status,
        enabled: install.enabled,
        order: install.order,
        pinned: install.pinned,
        installedAt: install.installedAt,
        config: install.config
          ? {
              settings: install.config.settings as Record<string, unknown>,
            }
          : undefined,
        deployment: {
          id: install.deployment.id,
          packageId: install.deployment.packageId,
          versionId: install.deployment.versionId,
          status: install.deployment.status,
          frontendUrl: install.deployment.frontendUrl,
          backendUrl: install.deployment.backendUrl,
          healthStatus: install.deployment.healthStatus,
          package: {
            name: install.deployment.package.name,
            displayName: install.deployment.package.displayName,
            icon: install.deployment.package.icon,
            category: install.deployment.package.category,
          },
          version: {
            version: install.deployment.version.version,
            manifest: install.deployment.version.manifest,
          },
        },
      }));
    },

    /**
     * Get a single tenant installation by ID
     */
    async getInstallation(
      userId: string,
      installId: string
    ): Promise<TenantInstallResult | null> {
      const install = await prisma.tenantPluginInstall.findFirst({
        where: {
          id: installId,
          userId,
        },
        include: {
          deployment: {
            include: {
              package: true,
              version: true,
            },
          },
          config: true,
        },
      });

      if (!install) return null;

      return {
        id: install.id,
        userId: install.userId,
        deploymentId: install.deploymentId,
        status: install.status,
        enabled: install.enabled,
        order: install.order,
        pinned: install.pinned,
        installedAt: install.installedAt,
        config: install.config
          ? {
              settings: install.config.settings as Record<string, unknown>,
            }
          : undefined,
        deployment: {
          id: install.deployment.id,
          packageId: install.deployment.packageId,
          versionId: install.deployment.versionId,
          status: install.deployment.status,
          frontendUrl: install.deployment.frontendUrl,
          backendUrl: install.deployment.backendUrl,
          healthStatus: install.deployment.healthStatus,
          package: {
            name: install.deployment.package.name,
            displayName: install.deployment.package.displayName,
            icon: install.deployment.package.icon,
            category: install.deployment.package.category,
          },
          version: {
            version: install.deployment.version.version,
            manifest: install.deployment.version.manifest,
          },
        },
      };
    },

    /**
     * Get tenant installation by plugin name
     */
    async getInstallationByPlugin(
      userId: string,
      pluginName: string
    ): Promise<TenantInstallResult | null> {
      const install = await prisma.tenantPluginInstall.findFirst({
        where: {
          userId,
          status: { not: 'uninstalled' },
          deployment: {
            package: {
              name: pluginName,
            },
          },
        },
        include: {
          deployment: {
            include: {
              package: true,
              version: true,
            },
          },
          config: true,
        },
      });

      if (!install) return null;

      return {
        id: install.id,
        userId: install.userId,
        deploymentId: install.deploymentId,
        status: install.status,
        enabled: install.enabled,
        order: install.order,
        pinned: install.pinned,
        installedAt: install.installedAt,
        config: install.config
          ? {
              settings: install.config.settings as Record<string, unknown>,
            }
          : undefined,
        deployment: {
          id: install.deployment.id,
          packageId: install.deployment.packageId,
          versionId: install.deployment.versionId,
          status: install.deployment.status,
          frontendUrl: install.deployment.frontendUrl,
          backendUrl: install.deployment.backendUrl,
          healthStatus: install.deployment.healthStatus,
          package: {
            name: install.deployment.package.name,
            displayName: install.deployment.package.displayName,
            icon: install.deployment.package.icon,
            category: install.deployment.package.category,
          },
          version: {
            version: install.deployment.version.version,
            manifest: install.deployment.version.manifest,
          },
        },
      };
    },

    /**
     * Create a virtual installation for a user
     * Returns the deployment ID for physical deployment if needed
     */
    async createInstallation(
      userId: string,
      deploymentId: string,
      initialConfig?: Record<string, unknown>
    ): Promise<{ install: TenantInstallResult; isFirstInstall: boolean }> {
      // Check if user already has this installation
      const existing = await prisma.tenantPluginInstall.findFirst({
        where: {
          userId,
          deploymentId,
        },
      });

      if (existing && existing.status !== 'uninstalled') {
        throw new Error('Plugin is already installed for this user');
      }

      // Reactivate if previously uninstalled
      if (existing) {
        const updated = await prisma.tenantPluginInstall.update({
          where: { id: existing.id },
          data: {
            status: 'active',
            enabled: true,
            installedAt: new Date(),
          },
          include: {
            deployment: {
              include: {
                package: true,
                version: true,
              },
            },
            config: true,
          },
        });

        // Increment active installs
        await prisma.pluginDeployment.update({
          where: { id: deploymentId },
          data: { activeInstalls: { increment: 1 } },
        });

        return {
          install: this.mapInstall(updated),
          isFirstInstall: false,
        };
      }

      // Get deployment to check if first install
      const deployment = await prisma.pluginDeployment.findUnique({
        where: { id: deploymentId },
      });

      if (!deployment) {
        throw new Error('Deployment not found');
      }

      const isFirstInstall = deployment.activeInstalls === 0;

      // Create new installation
      const install = await prisma.tenantPluginInstall.create({
        data: {
          userId,
          deploymentId,
          status: 'active',
          enabled: true,
          installedAt: new Date(),
          config: initialConfig
            ? {
                create: {
                  settings: initialConfig as Prisma.InputJsonValue,
                },
              }
            : undefined,
        },
        include: {
          deployment: {
            include: {
              package: true,
              version: true,
            },
          },
          config: true,
        },
      });

      // Increment active installs
      await prisma.pluginDeployment.update({
        where: { id: deploymentId },
        data: { activeInstalls: { increment: 1 } },
      });

      return {
        install: this.mapInstall(install),
        isFirstInstall,
      };
    },

    /**
     * Uninstall a plugin for a user (virtual uninstall)
     * Returns true if this was the last user and physical cleanup should occur
     */
    async uninstall(
      userId: string,
      installId: string
    ): Promise<{ success: boolean; shouldCleanup: boolean; deploymentId: string }> {
      const install = await prisma.tenantPluginInstall.findFirst({
        where: {
          id: installId,
          userId,
        },
        include: {
          deployment: true,
        },
      });

      if (!install) {
        throw new Error('Installation not found');
      }

      if (install.status === 'uninstalled') {
        throw new Error('Plugin is already uninstalled');
      }

      // Mark as uninstalled
      await prisma.tenantPluginInstall.update({
        where: { id: installId },
        data: { status: 'uninstalled' },
      });

      // Decrement active installs
      const deployment = await prisma.pluginDeployment.update({
        where: { id: install.deploymentId },
        data: { activeInstalls: { decrement: 1 } },
      });

      return {
        success: true,
        shouldCleanup: deployment.activeInstalls <= 0,
        deploymentId: install.deploymentId,
      };
    },

    /**
     * Update tenant preferences (enabled, order, pinned)
     */
    async updatePreferences(
      userId: string,
      installId: string,
      preferences: { enabled?: boolean; order?: number; pinned?: boolean }
    ): Promise<TenantInstallResult> {
      const install = await prisma.tenantPluginInstall.update({
        where: {
          id: installId,
          userId,
        },
        data: {
          enabled: preferences.enabled,
          order: preferences.order,
          pinned: preferences.pinned,
        },
        include: {
          deployment: {
            include: {
              package: true,
              version: true,
            },
          },
          config: true,
        },
      });

      return this.mapInstall(install);
    },

    /**
     * Get tenant configuration
     */
    async getConfig(userId: string, installId: string): Promise<TenantConfig | null> {
      const config = await prisma.tenantPluginConfig.findFirst({
        where: {
          tenantInstall: {
            id: installId,
            userId,
          },
        },
      });

      if (!config) return null;

      // Decrypt secrets if present
      let decryptedSecrets: Record<string, unknown> | undefined;
      if (config.secrets) {
        try {
          const secretsStr = config.secrets as { encryptedValue: string; iv: string };
          if (secretsStr.encryptedValue && secretsStr.iv) {
            const encryption = getEncryptionService();
            const decrypted = encryption.decrypt({ encryptedValue: secretsStr.encryptedValue, iv: secretsStr.iv });
            decryptedSecrets = JSON.parse(decrypted);
          }
        } catch {
          // Secrets might not be encrypted or failed to decrypt
          decryptedSecrets = config.secrets as Record<string, unknown>;
        }
      }

      return {
        settings: config.settings as Record<string, unknown>,
        secrets: decryptedSecrets,
      };
    },

    /**
     * Update tenant configuration
     */
    async updateConfig(
      userId: string,
      installId: string,
      config: Partial<TenantConfig>
    ): Promise<TenantConfig> {
      // Get existing config or create new one
      const existing = await prisma.tenantPluginConfig.findFirst({
        where: {
          tenantInstall: {
            id: installId,
            userId,
          },
        },
      });

      // Encrypt secrets if provided
      let encryptedSecrets: unknown = undefined;
      if (config.secrets) {
        const encryption = getEncryptionService();
        const result = encryption.encrypt(JSON.stringify(config.secrets));
        encryptedSecrets = { encryptedValue: result.encryptedValue, iv: result.iv };
      }

      if (existing) {
        const updated = await prisma.tenantPluginConfig.update({
          where: { id: existing.id },
          data: {
            settings: (config.settings ?? existing.settings) as Prisma.InputJsonValue,
            secrets: (encryptedSecrets ?? existing.secrets ?? undefined) as Prisma.InputJsonValue | undefined,
          },
        });

        return {
          settings: updated.settings as Record<string, unknown>,
          secrets: config.secrets,
        };
      }

      // Create new config
      const tenantInstall = await prisma.tenantPluginInstall.findFirst({
        where: {
          id: installId,
          userId,
        },
      });

      if (!tenantInstall) {
        throw new Error('Installation not found');
      }

      const created = await prisma.tenantPluginConfig.create({
        data: {
          tenantInstallId: installId,
          settings: (config.settings ?? {}) as Prisma.InputJsonValue,
          secrets: (encryptedSecrets ?? undefined) as Prisma.InputJsonValue | undefined,
        },
      });

      return {
        settings: created.settings as Record<string, unknown>,
        secrets: config.secrets,
      };
    },

    /**
     * Check if user has a plugin installed
     */
    async hasPlugin(userId: string, pluginName: string): Promise<boolean> {
      const install = await prisma.tenantPluginInstall.findFirst({
        where: {
          userId,
          status: 'active',
          deployment: {
            package: {
              name: pluginName,
            },
          },
        },
      });

      return !!install;
    },

    /**
     * Get all users with a specific plugin installed
     */
    async getUsersWithPlugin(deploymentId: string): Promise<string[]> {
      const installs = await prisma.tenantPluginInstall.findMany({
        where: {
          deploymentId,
          status: 'active',
        },
        select: { userId: true },
      });

      return installs.map((i) => i.userId);
    },

    /**
     * Helper: Map database result to TenantInstallResult
     */
    mapInstall(install: {
      id: string;
      userId: string;
      deploymentId: string;
      status: string;
      enabled: boolean;
      order: number;
      pinned: boolean;
      installedAt: Date;
      config: { settings: unknown } | null;
      deployment: {
        id: string;
        packageId: string;
        versionId: string;
        status: string;
        frontendUrl: string | null;
        backendUrl: string | null;
        healthStatus: string | null;
        package: {
          name: string;
          displayName: string;
          icon: string | null;
          category: string;
        };
        version: {
          version: string;
          manifest: unknown;
        };
      };
    }): TenantInstallResult {
      return {
        id: install.id,
        userId: install.userId,
        deploymentId: install.deploymentId,
        status: install.status,
        enabled: install.enabled,
        order: install.order,
        pinned: install.pinned,
        installedAt: install.installedAt,
        config: install.config
          ? {
              settings: install.config.settings as Record<string, unknown>,
            }
          : undefined,
        deployment: {
          id: install.deployment.id,
          packageId: install.deployment.packageId,
          versionId: install.deployment.versionId,
          status: install.deployment.status,
          frontendUrl: install.deployment.frontendUrl,
          backendUrl: install.deployment.backendUrl,
          healthStatus: install.deployment.healthStatus,
          package: {
            name: install.deployment.package.name,
            displayName: install.deployment.package.displayName,
            icon: install.deployment.package.icon,
            category: install.deployment.package.category,
          },
          version: {
            version: install.deployment.version.version,
            manifest: install.deployment.version.manifest,
          },
        },
      };
    },
  };
}

export type TenantService = ReturnType<typeof createTenantService>;
