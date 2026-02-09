/**
 * Health Check Scheduler
 *
 * Automated health check scheduling for plugin deployments.
 * Default interval: 5 minutes (configurable)
 */

import { PrismaClient } from '@naap/database';
import { createDeploymentService } from './deployment';

export interface HealthCheckConfig {
  /** Interval between health checks in milliseconds (default: 5 minutes) */
  intervalMs: number;
  /** Timeout for individual health check requests in milliseconds */
  timeoutMs: number;
  /** Number of consecutive failures before marking unhealthy */
  failureThreshold: number;
  /** Whether to auto-disable plugins that exceed failure threshold */
  autoDisable: boolean;
}

export interface HealthCheckResult {
  deploymentId: string;
  packageName: string;
  healthy: boolean;
  responseTime?: number;
  error?: string;
  timestamp: Date;
}

const DEFAULT_CONFIG: HealthCheckConfig = {
  intervalMs: 5 * 60 * 1000, // 5 minutes
  timeoutMs: 10000, // 10 seconds
  failureThreshold: 3,
  autoDisable: false,
};

// Track consecutive failures per deployment
const failureCounters: Map<string, number> = new Map();

// Scheduler state
let schedulerInterval: ReturnType<typeof setInterval> | null = null;
let isRunning = false;

/**
 * Create health check scheduler
 */
export function createHealthScheduler(
  prisma: PrismaClient,
  config: Partial<HealthCheckConfig> = {}
) {
  const deploymentService = createDeploymentService(prisma);
  const finalConfig: HealthCheckConfig = { ...DEFAULT_CONFIG, ...config };

  return {
    /**
     * Start the health check scheduler
     */
    start(): void {
      if (isRunning) {
        console.log('Health scheduler already running');
        return;
      }

      console.log(
        `🏥 Starting health check scheduler (interval: ${finalConfig.intervalMs / 1000}s)`
      );

      isRunning = true;

      // Run immediately on start
      this.runHealthChecks();

      // Schedule periodic checks
      schedulerInterval = setInterval(() => {
        this.runHealthChecks();
      }, finalConfig.intervalMs);
    },

    /**
     * Stop the health check scheduler
     */
    stop(): void {
      if (schedulerInterval) {
        clearInterval(schedulerInterval);
        schedulerInterval = null;
      }
      isRunning = false;
      console.log('🏥 Health check scheduler stopped');
    },

    /**
     * Check if scheduler is running
     */
    isRunning(): boolean {
      return isRunning;
    },

    /**
     * Run health checks for all running deployments
     */
    async runHealthChecks(): Promise<HealthCheckResult[]> {
      const results: HealthCheckResult[] = [];

      try {
        // Get deployments that need health check
        const lastCheckBefore = new Date(Date.now() - finalConfig.intervalMs);
        const deployments = await deploymentService.getDeploymentsForHealthCheck(
          lastCheckBefore
        );

        console.log(`🏥 Running health checks for ${deployments.length} deployments`);

        // Check each deployment
        for (const deployment of deployments) {
          const result = await this.checkDeployment(deployment.id, deployment.backendUrl);
          results.push(result);
        }

        // Log summary
        const healthy = results.filter((r) => r.healthy).length;
        const unhealthy = results.length - healthy;
        console.log(
          `🏥 Health check complete: ${healthy} healthy, ${unhealthy} unhealthy`
        );
      } catch (error) {
        console.error('Health check scheduler error:', error);
      }

      return results;
    },

    /**
     * Check health of a specific deployment
     */
    async checkDeployment(
      deploymentId: string,
      backendUrl: string | null
    ): Promise<HealthCheckResult> {
      // Get package info for logging
      const deployment = await prisma.pluginDeployment.findUnique({
        where: { id: deploymentId },
        include: { package: { select: { name: true } } },
      });

      const packageName = deployment?.package?.name || 'unknown';

      // If no backend URL, consider it healthy (frontend-only plugin)
      if (!backendUrl) {
        await deploymentService.updateHealthStatus(deploymentId, 'healthy');
        return {
          deploymentId,
          packageName,
          healthy: true,
          timestamp: new Date(),
        };
      }

      const healthUrl = `${backendUrl}/health`;
      const startTime = Date.now();

      try {
        const controller = new AbortController();
        const timeout = setTimeout(
          () => controller.abort(),
          finalConfig.timeoutMs
        );

        const response = await fetch(healthUrl, {
          method: 'GET',
          signal: controller.signal,
          headers: {
            'Accept': 'application/json',
          },
        });

        clearTimeout(timeout);

        const responseTime = Date.now() - startTime;
        const healthy = response.ok;

        // Update status
        await deploymentService.updateHealthStatus(
          deploymentId,
          healthy ? 'healthy' : 'unhealthy'
        );

        // Reset failure counter on success
        if (healthy) {
          failureCounters.delete(deploymentId);
        } else {
          await this.handleFailure(deploymentId, packageName, `HTTP ${response.status}`);
        }

        return {
          deploymentId,
          packageName,
          healthy,
          responseTime,
          timestamp: new Date(),
        };
      } catch (error) {
        const responseTime = Date.now() - startTime;
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';

        // Update status
        await deploymentService.updateHealthStatus(deploymentId, 'unhealthy');

        // Handle failure
        await this.handleFailure(deploymentId, packageName, errorMsg);

        return {
          deploymentId,
          packageName,
          healthy: false,
          responseTime,
          error: errorMsg,
          timestamp: new Date(),
        };
      }
    },

    /**
     * Handle deployment health check failure
     */
    async handleFailure(
      deploymentId: string,
      packageName: string,
      error: string
    ): Promise<void> {
      // Increment failure counter
      const currentFailures = (failureCounters.get(deploymentId) || 0) + 1;
      failureCounters.set(deploymentId, currentFailures);

      console.warn(
        `⚠️ Health check failed for ${packageName}: ${error} (${currentFailures}/${finalConfig.failureThreshold})`
      );

      // Check if we've exceeded the threshold
      if (
        finalConfig.autoDisable &&
        currentFailures >= finalConfig.failureThreshold
      ) {
        console.error(
          `🛑 Auto-disabling ${packageName} after ${currentFailures} consecutive failures`
        );

        // Stop the deployment
        await deploymentService.stopDeployment(deploymentId);

        // Reset counter
        failureCounters.delete(deploymentId);
      }
    },

    /**
     * Get current failure counters (for monitoring)
     */
    getFailureCounters(): Map<string, number> {
      return new Map(failureCounters);
    },

    /**
     * Reset failure counter for a deployment
     */
    resetFailureCounter(deploymentId: string): void {
      failureCounters.delete(deploymentId);
    },

    /**
     * Force immediate health check for a specific deployment
     */
    async forceCheck(deploymentId: string): Promise<HealthCheckResult> {
      const deployment = await prisma.pluginDeployment.findUnique({
        where: { id: deploymentId },
        select: { id: true, backendUrl: true },
      });

      if (!deployment) {
        throw new Error('Deployment not found');
      }

      return this.checkDeployment(deployment.id, deployment.backendUrl);
    },

    /**
     * Get health check configuration
     */
    getConfig(): HealthCheckConfig {
      return { ...finalConfig };
    },
  };
}

/**
 * Export default health scheduler instance
 * Should be initialized with Prisma client in main server
 */
export type HealthScheduler = ReturnType<typeof createHealthScheduler>;
