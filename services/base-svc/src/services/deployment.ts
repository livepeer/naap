/**
 * Deployment Service
 * Manages physical plugin deployments with lazy provisioning and reference counting
 */

import { PrismaClient } from '@naap/database';

export interface DeploymentResult {
  id: string;
  packageId: string;
  versionId: string;
  status: string;
  frontendUrl: string | null;
  backendUrl: string | null;
  containerPort: number | null;
  databaseSchema: string | null;
  activeInstalls: number;
  deployedAt: Date | null;
  lastHealthCheck: Date | null;
  healthStatus: string | null;
  package: {
    name: string;
    displayName: string;
    icon: string | null;
    category: string;
  };
  version: {
    version: string;
    frontendUrl: string | null;
    backendImage: string | null;
  };
}

export interface DeploymentConfig {
  frontendUrl?: string;
  backendUrl?: string;
  containerPort?: number;
  databaseSchema?: string;
}

export function createDeploymentService(prisma: PrismaClient) {
  return {
    /**
     * List all deployments (admin only)
     */
    async listDeployments(): Promise<DeploymentResult[]> {
      const deployments = await prisma.pluginDeployment.findMany({
        include: {
          package: true,
          version: true,
        },
        orderBy: { createdAt: 'desc' },
      });

      return deployments.map((d) => ({
        id: d.id,
        packageId: d.packageId,
        versionId: d.versionId,
        status: d.status,
        frontendUrl: d.frontendUrl,
        backendUrl: d.backendUrl,
        containerPort: d.containerPort,
        databaseSchema: d.databaseSchema,
        activeInstalls: d.activeInstalls,
        deployedAt: d.deployedAt,
        lastHealthCheck: d.lastHealthCheck,
        healthStatus: d.healthStatus,
        package: {
          name: d.package.name,
          displayName: d.package.displayName,
          icon: d.package.icon,
          category: d.package.category,
        },
        version: {
          version: d.version.version,
          frontendUrl: d.version.frontendUrl,
          backendImage: d.version.backendImage,
        },
      }));
    },

    /**
     * Get deployment by package ID
     */
    async getDeploymentByPackage(packageId: string): Promise<DeploymentResult | null> {
      const deployment = await prisma.pluginDeployment.findUnique({
        where: { packageId },
        include: {
          package: true,
          version: true,
        },
      });

      if (!deployment) return null;

      return {
        id: deployment.id,
        packageId: deployment.packageId,
        versionId: deployment.versionId,
        status: deployment.status,
        frontendUrl: deployment.frontendUrl,
        backendUrl: deployment.backendUrl,
        containerPort: deployment.containerPort,
        databaseSchema: deployment.databaseSchema,
        activeInstalls: deployment.activeInstalls,
        deployedAt: deployment.deployedAt,
        lastHealthCheck: deployment.lastHealthCheck,
        healthStatus: deployment.healthStatus,
        package: {
          name: deployment.package.name,
          displayName: deployment.package.displayName,
          icon: deployment.package.icon,
          category: deployment.package.category,
        },
        version: {
          version: deployment.version.version,
          frontendUrl: deployment.version.frontendUrl,
          backendImage: deployment.version.backendImage,
        },
      };
    },

    /**
     * Get deployment by plugin name
     */
    async getDeploymentByName(pluginName: string): Promise<DeploymentResult | null> {
      const pkg = await prisma.pluginPackage.findUnique({
        where: { name: pluginName },
      });

      if (!pkg) return null;

      return this.getDeploymentByPackage(pkg.id);
    },

    /**
     * Get or create deployment for a package
     * Implements lazy provisioning - deployment is created when first user installs
     */
    async getOrCreateDeployment(
      packageId: string,
      versionId?: string
    ): Promise<{ deployment: DeploymentResult; isNew: boolean }> {
      // Check for existing deployment
      const existing = await prisma.pluginDeployment.findUnique({
        where: { packageId },
        include: {
          package: true,
          version: true,
        },
      });

      if (existing) {
        return {
          deployment: {
            id: existing.id,
            packageId: existing.packageId,
            versionId: existing.versionId,
            status: existing.status,
            frontendUrl: existing.frontendUrl,
            backendUrl: existing.backendUrl,
            containerPort: existing.containerPort,
            databaseSchema: existing.databaseSchema,
            activeInstalls: existing.activeInstalls,
            deployedAt: existing.deployedAt,
            lastHealthCheck: existing.lastHealthCheck,
            healthStatus: existing.healthStatus,
            package: {
              name: existing.package.name,
              displayName: existing.package.displayName,
              icon: existing.package.icon,
              category: existing.package.category,
            },
            version: {
              version: existing.version.version,
              frontendUrl: existing.version.frontendUrl,
              backendImage: existing.version.backendImage,
            },
          },
          isNew: false,
        };
      }

      // Get latest version if not specified
      let targetVersionId = versionId;
      if (!targetVersionId) {
        const latestVersion = await prisma.pluginVersion.findFirst({
          where: { packageId },
          orderBy: { publishedAt: 'desc' },
        });
        if (!latestVersion) {
          throw new Error('No version available for this package');
        }
        targetVersionId = latestVersion.id;
      }

      // Create new deployment (pending state)
      const deployment = await prisma.pluginDeployment.create({
        data: {
          packageId,
          versionId: targetVersionId,
          status: 'pending',
          activeInstalls: 0,
        },
        include: {
          package: true,
          version: true,
        },
      });

      return {
        deployment: {
          id: deployment.id,
          packageId: deployment.packageId,
          versionId: deployment.versionId,
          status: deployment.status,
          frontendUrl: deployment.frontendUrl,
          backendUrl: deployment.backendUrl,
          containerPort: deployment.containerPort,
          databaseSchema: deployment.databaseSchema,
          activeInstalls: deployment.activeInstalls,
          deployedAt: deployment.deployedAt,
          lastHealthCheck: deployment.lastHealthCheck,
          healthStatus: deployment.healthStatus,
          package: {
            name: deployment.package.name,
            displayName: deployment.package.displayName,
            icon: deployment.package.icon,
            category: deployment.package.category,
          },
          version: {
            version: deployment.version.version,
            frontendUrl: deployment.version.frontendUrl,
            backendImage: deployment.version.backendImage,
          },
        },
        isNew: true,
      };
    },

    /**
     * Start deployment process
     * Called when first user installs a plugin
     */
    async startDeployment(deploymentId: string): Promise<void> {
      await prisma.pluginDeployment.update({
        where: { id: deploymentId },
        data: { status: 'deploying' },
      });
    },

    /**
     * Complete deployment with infrastructure details
     */
    async completeDeployment(
      deploymentId: string,
      config: DeploymentConfig
    ): Promise<DeploymentResult> {
      const deployment = await prisma.pluginDeployment.update({
        where: { id: deploymentId },
        data: {
          status: 'running',
          frontendUrl: config.frontendUrl,
          backendUrl: config.backendUrl,
          containerPort: config.containerPort,
          databaseSchema: config.databaseSchema,
          deployedAt: new Date(),
          healthStatus: 'healthy',
        },
        include: {
          package: true,
          version: true,
        },
      });

      return {
        id: deployment.id,
        packageId: deployment.packageId,
        versionId: deployment.versionId,
        status: deployment.status,
        frontendUrl: deployment.frontendUrl,
        backendUrl: deployment.backendUrl,
        containerPort: deployment.containerPort,
        databaseSchema: deployment.databaseSchema,
        activeInstalls: deployment.activeInstalls,
        deployedAt: deployment.deployedAt,
        lastHealthCheck: deployment.lastHealthCheck,
        healthStatus: deployment.healthStatus,
        package: {
          name: deployment.package.name,
          displayName: deployment.package.displayName,
          icon: deployment.package.icon,
          category: deployment.package.category,
        },
        version: {
          version: deployment.version.version,
          frontendUrl: deployment.version.frontendUrl,
          backendImage: deployment.version.backendImage,
        },
      };
    },

    /**
     * Mark deployment as failed
     */
    async failDeployment(deploymentId: string): Promise<void> {
      await prisma.pluginDeployment.update({
        where: { id: deploymentId },
        data: { status: 'failed' },
      });
    },

    /**
     * Stop deployment (when last user uninstalls)
     */
    async stopDeployment(deploymentId: string): Promise<void> {
      await prisma.pluginDeployment.update({
        where: { id: deploymentId },
        data: {
          status: 'stopped',
          healthStatus: null,
        },
      });
    },

    /**
     * Cleanup deployment resources
     * Called when last user uninstalls
     */
    async cleanupDeployment(deploymentId: string): Promise<boolean> {
      const deployment = await prisma.pluginDeployment.findUnique({
        where: { id: deploymentId },
        include: {
          package: {
            select: {
              name: true,
              icon: true,
            },
          },
        },
      });

      if (!deployment) {
        throw new Error('Deployment not found');
      }

      // Only cleanup if no active installs
      if (deployment.activeInstalls > 0) {
        return false;
      }

      const cleanupTasks: Array<{ name: string; fn: () => Promise<void> }> = [];

      // 1. Stop backend service (if has backend)
      if (deployment.backendUrl) {
        cleanupTasks.push({
          name: 'stopBackend',
          fn: async () => {
            // In production, this would stop the Docker container
            // For local dev, send shutdown signal to backend
            try {
              const controller = new AbortController();
              const timeout = setTimeout(() => controller.abort(), 5000);

              await fetch(`${deployment.backendUrl}/shutdown`, {
                method: 'POST',
                signal: controller.signal,
                headers: { 'X-Internal-Token': process.env.INTERNAL_TOKEN || '' },
              }).catch(() => {
                // Ignore errors - backend may already be down
              });

              clearTimeout(timeout);
            } catch (e) {
              console.log(`Backend shutdown signal sent (or already down): ${deployment.backendUrl}`);
            }
          },
        });
      }

      // 2. Archive database tables (mark for archival, actual archive is async)
      cleanupTasks.push({
        name: 'markForArchival',
        fn: async () => {
          // In production, this would trigger a background job to archive data
          // For now, log the intent for the deployment
          console.log(`Archival marked for deployment ${deploymentId} (package: ${deployment.package.name})`);
        },
      });

      // 3. Mark frontend assets for cleanup (CDN purge would happen async)
      if (deployment.frontendUrl) {
        cleanupTasks.push({
          name: 'markCdnCleanup',
          fn: async () => {
            // In production, queue a CDN purge job
            // For now, just log the intent
            console.log(`CDN cleanup scheduled for: ${deployment.frontendUrl}`);
          },
        });
      }

      // Execute cleanup tasks with error handling
      const results: Array<{ task: string; success: boolean; error?: string }> = [];

      for (const task of cleanupTasks) {
        try {
          await task.fn();
          results.push({ task: task.name, success: true });
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : 'Unknown error';
          console.error(`Cleanup task ${task.name} failed:`, errorMsg);
          results.push({ task: task.name, success: false, error: errorMsg });
        }
      }

      // Update deployment status
      await prisma.pluginDeployment.update({
        where: { id: deploymentId },
        data: {
          status: 'stopped',
          healthStatus: null,
        },
      });

      // Log cleanup results for monitoring
      console.log(`Deployment ${deploymentId} cleanup completed:`, {
        package: deployment.package.name,
        results,
        cleanedUpAt: new Date().toISOString(),
      });

      // Return true if all critical tasks succeeded
      const criticalFailures = results.filter(r => !r.success && r.task !== 'markCdnCleanup');
      return criticalFailures.length === 0;
    },

    /**
     * Update health status
     */
    async updateHealthStatus(
      deploymentId: string,
      status: 'healthy' | 'unhealthy' | 'unknown'
    ): Promise<void> {
      await prisma.pluginDeployment.update({
        where: { id: deploymentId },
        data: {
          lastHealthCheck: new Date(),
          healthStatus: status,
        },
      });
    },

    /**
     * Get deployments needing health check
     */
    async getDeploymentsForHealthCheck(
      lastCheckBefore: Date
    ): Promise<{ id: string; backendUrl: string | null }[]> {
      const deployments = await prisma.pluginDeployment.findMany({
        where: {
          status: 'running',
          OR: [
            { lastHealthCheck: null },
            { lastHealthCheck: { lt: lastCheckBefore } },
          ],
        },
        select: {
          id: true,
          backendUrl: true,
        },
      });

      return deployments;
    },

    /**
     * Upgrade deployment to new version
     */
    async upgradeDeployment(
      deploymentId: string,
      newVersionId: string
    ): Promise<DeploymentResult> {
      const deployment = await prisma.pluginDeployment.update({
        where: { id: deploymentId },
        data: {
          versionId: newVersionId,
          status: 'deploying',
        },
        include: {
          package: true,
          version: true,
        },
      });

      return {
        id: deployment.id,
        packageId: deployment.packageId,
        versionId: deployment.versionId,
        status: deployment.status,
        frontendUrl: deployment.frontendUrl,
        backendUrl: deployment.backendUrl,
        containerPort: deployment.containerPort,
        databaseSchema: deployment.databaseSchema,
        activeInstalls: deployment.activeInstalls,
        deployedAt: deployment.deployedAt,
        lastHealthCheck: deployment.lastHealthCheck,
        healthStatus: deployment.healthStatus,
        package: {
          name: deployment.package.name,
          displayName: deployment.package.displayName,
          icon: deployment.package.icon,
          category: deployment.package.category,
        },
        version: {
          version: deployment.version.version,
          frontendUrl: deployment.version.frontendUrl,
          backendImage: deployment.version.backendImage,
        },
      };
    },

    /**
     * Get deployment statistics
     */
    async getStats(): Promise<{
      total: number;
      running: number;
      stopped: number;
      failed: number;
      totalActiveInstalls: number;
    }> {
      const [total, running, stopped, failed, installs] = await Promise.all([
        prisma.pluginDeployment.count(),
        prisma.pluginDeployment.count({ where: { status: 'running' } }),
        prisma.pluginDeployment.count({ where: { status: 'stopped' } }),
        prisma.pluginDeployment.count({ where: { status: 'failed' } }),
        prisma.pluginDeployment.aggregate({
          _sum: { activeInstalls: true },
        }),
      ]);

      return {
        total,
        running,
        stopped,
        failed,
        totalActiveInstalls: installs._sum.activeInstalls || 0,
      };
    },
  };
}

export type DeploymentService = ReturnType<typeof createDeploymentService>;
