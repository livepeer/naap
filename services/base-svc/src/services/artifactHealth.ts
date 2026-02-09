/**
 * Artifact Health Monitoring Service
 * Ensures published artifacts remain accessible
 */

import { db } from '../db/client';
import { storageClient } from './storageClient';
import { dockerHubClient, ghcrClient } from './dockerRegistry';

export interface ArtifactHealthResult {
  packageName: string;
  version: string;
  frontendHealthy: boolean | null;
  backendHealthy: boolean | null;
  lastChecked: Date;
  issues: string[];
}

export interface HealthCheckConfig {
  checkInterval: number; // ms
  frontendTimeout: number; // ms
  backendTimeout: number; // ms
  maxConcurrent: number;
  autoDeprecate: boolean;
  alertThreshold: number; // consecutive failures before alert
}

const DEFAULT_CONFIG: HealthCheckConfig = {
  checkInterval: 60 * 60 * 1000, // 1 hour
  frontendTimeout: 10000, // 10 seconds
  backendTimeout: 30000, // 30 seconds
  maxConcurrent: 5,
  autoDeprecate: false,
  alertThreshold: 3,
};

/**
 * Create artifact health service
 */
export function createArtifactHealthService(config: Partial<HealthCheckConfig> = {}) {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  
  // Track consecutive failures
  const failureCount = new Map<string, number>();
  
  // Health check interval handle
  let checkInterval: ReturnType<typeof setInterval> | null = null;

  return {
    /**
     * Check health of a single artifact
     */
    async checkArtifact(
      packageName: string,
      version: string
    ): Promise<ArtifactHealthResult> {
      const result: ArtifactHealthResult = {
        packageName,
        version,
        frontendHealthy: null,
        backendHealthy: null,
        lastChecked: new Date(),
        issues: [],
      };

      // Get version info
      const pkg = await db.pluginPackage.findUnique({ 
        where: { name: packageName },
      });
      
      if (!pkg) {
        result.issues.push('Package not found');
        return result;
      }

      const versionInfo = await db.pluginVersion.findFirst({
        where: { packageId: pkg.id, version },
      });

      if (!versionInfo) {
        result.issues.push('Version not found');
        return result;
      }

      // Check frontend artifacts
      if (versionInfo.frontendUrl) {
        try {
          const response = await fetch(versionInfo.frontendUrl, {
            method: 'HEAD',
            signal: AbortSignal.timeout(cfg.frontendTimeout),
          });
          
          result.frontendHealthy = response.ok;
          
          if (!response.ok) {
            result.issues.push(`Frontend returned ${response.status}`);
          }
        } catch (error) {
          result.frontendHealthy = false;
          result.issues.push(`Frontend unreachable: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
      }

      // Check backend image
      if (versionInfo.backendImage) {
        try {
          // Parse image reference
          const [imageName, tag = 'latest'] = versionInfo.backendImage.split(':');
          const registry = imageName.startsWith('ghcr.io') ? 'ghcr' : 'dockerhub';
          const client = registry === 'ghcr' ? ghcrClient : dockerHubClient;
          
          const cleanImageName = imageName.replace(/^ghcr\.io\//, '');
          const exists = await client.imageExists(cleanImageName, tag);
          
          result.backendHealthy = exists;
          
          if (!exists) {
            result.issues.push('Backend image not found');
          }
        } catch (error) {
          result.backendHealthy = false;
          result.issues.push(`Backend check failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
      }

      // Update installation health status
      const installation = await db.pluginInstallation.findFirst({
        where: { packageId: pkg.id },
      });

      if (installation) {
        const isHealthy = 
          (result.frontendHealthy === null || result.frontendHealthy) &&
          (result.backendHealthy === null || result.backendHealthy);

        await db.pluginInstallation.update({
          where: { id: installation.id },
          data: {
            lastHealthCheck: new Date(),
            healthStatus: isHealthy ? 'healthy' : 'unhealthy',
          },
        });
      }

      // Track failures
      const key = `${packageName}@${version}`;
      if (result.issues.length > 0) {
        const count = (failureCount.get(key) || 0) + 1;
        failureCount.set(key, count);

        // Auto-deprecate if threshold reached
        if (cfg.autoDeprecate && count >= cfg.alertThreshold) {
          await this.handlePersistentFailure(packageName, version, result.issues);
        }
      } else {
        failureCount.delete(key);
      }

      return result;
    },

    /**
     * Handle persistent failures
     */
    async handlePersistentFailure(
      packageName: string,
      version: string,
      issues: string[]
    ): Promise<void> {
      console.warn(`Artifact ${packageName}@${version} has persistent issues:`, issues);

      // Log the event
      await db.auditLog.create({
        data: {
          action: 'artifact.unhealthy',
          resource: 'plugin',
          resourceId: packageName,
          details: {
            version,
            issues,
            consecutiveFailures: failureCount.get(`${packageName}@${version}`),
          },
          status: 'failure',
          errorMsg: issues.join('; '),
        },
      });

      // Optionally auto-deprecate
      if (cfg.autoDeprecate) {
        const pkg = await db.pluginPackage.findUnique({ where: { name: packageName } });
        if (pkg) {
          await db.pluginVersion.updateMany({
            where: { packageId: pkg.id, version },
            data: {
              deprecated: true,
              deprecationMsg: `Auto-deprecated: ${issues.join(', ')}`,
            },
          });

          console.warn(`Auto-deprecated ${packageName}@${version}`);
        }
      }
    },

    /**
     * Check health of all installed plugins
     */
    async checkAllInstalled(): Promise<ArtifactHealthResult[]> {
      const results: ArtifactHealthResult[] = [];

      const installations = await db.pluginInstallation.findMany({
        where: { status: 'installed' },
        include: {
          package: true,
          version: true,
        },
      });

      // Process in batches
      for (let i = 0; i < installations.length; i += cfg.maxConcurrent) {
        const batch = installations.slice(i, i + cfg.maxConcurrent);
        
        const batchResults = await Promise.all(
          batch.map(inst => this.checkArtifact(inst.package.name, inst.version.version))
        );
        
        results.push(...batchResults);
      }

      return results;
    },

    /**
     * Check health of all published versions
     */
    async checkAllPublished(): Promise<ArtifactHealthResult[]> {
      const results: ArtifactHealthResult[] = [];

      const versions = await db.pluginVersion.findMany({
        where: { deprecated: false },
        include: { package: true },
        orderBy: { publishedAt: 'desc' },
      });

      // Only check latest version per package
      const latestByPackage = new Map<string, typeof versions[0]>();
      for (const v of versions) {
        if (!latestByPackage.has(v.package.name)) {
          latestByPackage.set(v.package.name, v);
        }
      }

      const toCheck = Array.from(latestByPackage.values());

      // Process in batches
      for (let i = 0; i < toCheck.length; i += cfg.maxConcurrent) {
        const batch = toCheck.slice(i, i + cfg.maxConcurrent);
        
        const batchResults = await Promise.all(
          batch.map(v => this.checkArtifact(v.package.name, v.version))
        );
        
        results.push(...batchResults);
      }

      return results;
    },

    /**
     * Get health status summary
     */
    async getHealthSummary(): Promise<{
      total: number;
      healthy: number;
      unhealthy: number;
      unknown: number;
      issues: Array<{ package: string; version: string; issues: string[] }>;
    }> {
      const installations = await db.pluginInstallation.findMany({
        where: { status: 'installed' },
        include: { package: true, version: true },
      });

      let healthy = 0;
      let unhealthy = 0;
      let unknown = 0;
      const issues: Array<{ package: string; version: string; issues: string[] }> = [];

      for (const inst of installations) {
        switch (inst.healthStatus) {
          case 'healthy':
            healthy++;
            break;
          case 'unhealthy':
            unhealthy++;
            // Get issues from recent audit log
            const recentLog = await db.auditLog.findFirst({
              where: {
                action: 'artifact.unhealthy',
                resourceId: inst.package.name,
              },
              orderBy: { createdAt: 'desc' },
            });
            if (recentLog?.details && typeof recentLog.details === 'object') {
              const details = recentLog.details as { issues?: string[] };
              issues.push({
                package: inst.package.name,
                version: inst.version.version,
                issues: details.issues || ['Unknown issue'],
              });
            }
            break;
          default:
            unknown++;
        }
      }

      return {
        total: installations.length,
        healthy,
        unhealthy,
        unknown,
        issues,
      };
    },

    /**
     * Start periodic health checks
     */
    start(): void {
      if (checkInterval) {
        console.warn('Health check already running');
        return;
      }

      console.log('Starting artifact health monitoring...');
      
      // Run immediately
      this.checkAllInstalled().catch(console.error);
      
      // Then periodically
      checkInterval = setInterval(async () => {
        try {
          await this.checkAllInstalled();
        } catch (error) {
          console.error('Health check failed:', error);
        }
      }, cfg.checkInterval);
    },

    /**
     * Stop periodic health checks
     */
    stop(): void {
      if (checkInterval) {
        clearInterval(checkInterval);
        checkInterval = null;
        console.log('Artifact health monitoring stopped');
      }
    },
  };
}

// Export singleton
export const artifactHealth = createArtifactHealthService();
