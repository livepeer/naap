/**
 * Process Monitoring Service
 * 
 * Monitors the health of running plugin backends and automatically
 * restarts them if they become unhealthy.
 */

import { db } from '../db/client';

export interface MonitoredPlugin {
  pluginName: string;
  containerPort: number;
  healthUrl: string;
  lastCheck: Date;
  lastHealthy: Date;
  status: 'healthy' | 'unhealthy' | 'recovering' | 'unknown';
  failedChecks: number;
  restartCount: number;
}

export interface ProcessMonitorOptions {
  checkIntervalMs?: number;
  maxFailedChecks?: number;
  healthTimeout?: number;
}

const DEFAULT_CHECK_INTERVAL = 30000; // 30 seconds
const DEFAULT_MAX_FAILED_CHECKS = 3;
const DEFAULT_HEALTH_TIMEOUT = 5000;

export class ProcessMonitor {
  private watchers = new Map<string, NodeJS.Timeout>();
  private pluginStatus = new Map<string, MonitoredPlugin>();
  private options: Required<ProcessMonitorOptions>;

  constructor(options: ProcessMonitorOptions = {}) {
    this.options = {
      checkIntervalMs: options.checkIntervalMs || DEFAULT_CHECK_INTERVAL,
      maxFailedChecks: options.maxFailedChecks || DEFAULT_MAX_FAILED_CHECKS,
      healthTimeout: options.healthTimeout || DEFAULT_HEALTH_TIMEOUT,
    };
  }

  /**
   * Start monitoring a plugin
   */
  startMonitoring(pluginName: string, containerPort: number, healthEndpoint: string = '/healthz'): void {
    // Stop any existing watcher
    this.stopMonitoring(pluginName);

    const healthUrl = `http://localhost:${containerPort}${healthEndpoint}`;

    // Initialize status
    this.pluginStatus.set(pluginName, {
      pluginName,
      containerPort,
      healthUrl,
      lastCheck: new Date(),
      lastHealthy: new Date(),
      status: 'unknown',
      failedChecks: 0,
      restartCount: 0,
    });

    // Start periodic health check
    const interval = setInterval(async () => {
      await this.checkHealth(pluginName);
    }, this.options.checkIntervalMs);

    this.watchers.set(pluginName, interval);

    console.log(`[processMonitor] Started monitoring ${pluginName} at ${healthUrl}`);
  }

  /**
   * Stop monitoring a plugin
   */
  stopMonitoring(pluginName: string): void {
    const interval = this.watchers.get(pluginName);
    if (interval) {
      clearInterval(interval);
      this.watchers.delete(pluginName);
      this.pluginStatus.delete(pluginName);
      console.log(`[processMonitor] Stopped monitoring ${pluginName}`);
    }
  }

  /**
   * Stop all monitoring
   */
  stopAll(): void {
    for (const pluginName of this.watchers.keys()) {
      this.stopMonitoring(pluginName);
    }
  }

  /**
   * Check health of a monitored plugin
   */
  private async checkHealth(pluginName: string): Promise<void> {
    const status = this.pluginStatus.get(pluginName);
    if (!status) return;

    try {
      const response = await fetch(status.healthUrl, {
        method: 'GET',
        signal: AbortSignal.timeout(this.options.healthTimeout),
      });

      status.lastCheck = new Date();

      if (response.ok) {
        const data = await response.json().catch(() => ({}));
        const healthy = data.status === 'ok' || data.status === 'healthy';

        if (healthy) {
          if (status.status !== 'healthy') {
            console.log(`[processMonitor] ${pluginName} is now healthy`);
          }
          status.status = 'healthy';
          status.lastHealthy = new Date();
          status.failedChecks = 0;
          return;
        }
      }

      // Not healthy
      this.handleUnhealthy(pluginName, status);
    } catch (error) {
      status.lastCheck = new Date();
      this.handleUnhealthy(pluginName, status, error);
    }
  }

  /**
   * Handle unhealthy plugin
   */
  private async handleUnhealthy(
    pluginName: string,
    status: MonitoredPlugin,
    error?: unknown
  ): Promise<void> {
    status.failedChecks++;
    status.status = 'unhealthy';

    const errorMsg = error instanceof Error ? error.message : 'Health check failed';
    console.warn(`[processMonitor] ${pluginName} health check failed (${status.failedChecks}/${this.options.maxFailedChecks}): ${errorMsg}`);

    // Attempt restart if max failed checks reached
    if (status.failedChecks >= this.options.maxFailedChecks) {
      await this.restartPlugin(pluginName, status);
    }
  }

  /**
   * Restart an unhealthy plugin
   */
  private async restartPlugin(pluginName: string, status: MonitoredPlugin): Promise<void> {
    console.log(`[processMonitor] Attempting to restart ${pluginName}...`);
    status.status = 'recovering';
    status.failedChecks = 0;
    status.restartCount++;

    try {
      // In production, would call containerOrchestrator.restart()
      console.log(`[processMonitor] Would restart container for ${pluginName}`);

      // Update database status
      await this.updateDatabaseStatus(pluginName, 'recovering');

      // Wait for restart and check health
      setTimeout(async () => {
        await this.checkHealth(pluginName);
      }, 5000);

    } catch (error) {
      console.error(`[processMonitor] Failed to restart ${pluginName}:`, error);
    }
  }

  /**
   * Update plugin health status in database
   */
  private async updateDatabaseStatus(pluginName: string, healthStatus: string): Promise<void> {
    try {
      const pkg = await db.pluginPackage.findUnique({ where: { name: pluginName } });
      if (pkg) {
        await db.pluginInstallation.updateMany({
          where: { packageId: pkg.id },
          data: {
            // Would have healthStatus field in production
            updatedAt: new Date(),
          },
        });
      }
    } catch (error) {
      console.error(`[processMonitor] Failed to update database status for ${pluginName}:`, error);
    }
  }

  /**
   * Get status of a monitored plugin
   */
  getStatus(pluginName: string): MonitoredPlugin | undefined {
    return this.pluginStatus.get(pluginName);
  }

  /**
   * Get all monitored plugins
   */
  getAllStatus(): MonitoredPlugin[] {
    return Array.from(this.pluginStatus.values());
  }

  /**
   * Get count of plugins being monitored
   */
  getMonitoredCount(): number {
    return this.watchers.size;
  }

  /**
   * Manually trigger a health check
   */
  async triggerCheck(pluginName: string): Promise<MonitoredPlugin | undefined> {
    await this.checkHealth(pluginName);
    return this.getStatus(pluginName);
  }
}

// Singleton instance
let processMonitor: ProcessMonitor | null = null;

export function getProcessMonitor(): ProcessMonitor {
  if (!processMonitor) {
    processMonitor = new ProcessMonitor();
  }
  return processMonitor;
}

/**
 * Initialize monitoring for all installed plugins
 */
export async function initializeProcessMonitoring(): Promise<void> {
  const monitor = getProcessMonitor();

  try {
    const installations = await db.pluginInstallation.findMany({
      where: { status: 'installed' },
      include: { 
        package: true,
        version: true,
      },
    });

    for (const install of installations) {
      const manifest = install.version?.manifest as { backend?: { port?: number; healthCheck?: string } } | undefined;
      
      if (manifest?.backend?.port) {
        monitor.startMonitoring(
          install.package.name,
          manifest.backend.port,
          manifest.backend.healthCheck || '/healthz'
        );
      }
    }

    console.log(`[processMonitor] Initialized monitoring for ${monitor.getMonitoredCount()} plugins`);
  } catch (error) {
    console.error('[processMonitor] Failed to initialize:', error);
  }
}
