/**
 * Health Monitor Service
 * Continuously monitors plugin health and triggers alerts/rollbacks
 *
 * Features:
 * - Periodic health checks with configurable intervals
 * - Consecutive failure tracking
 * - Auto-rollback on health degradation
 * - Integration with DeploymentManager for rollback
 * - Metrics recording for observability
 */

import { PrismaClient, PluginDeploymentSlot } from '@naap/database';
import { createDeploymentManager, DeploymentManager } from './deploymentManager';
import { SlotName as SharedSlotName, HealthStatus as SharedHealthStatus } from './deploymentTypes';

// =============================================================================
// Types
// =============================================================================

export type SlotName = 'blue' | 'green';

export interface HealthCheckConfig {
  /** Health check endpoint path */
  endpoint: string;
  /** Interval between health checks in seconds */
  intervalSeconds: number;
  /** Timeout for each health check in seconds */
  timeoutSeconds: number;
  /** Number of consecutive failures before marking unhealthy */
  unhealthyThreshold: number;
  /** Number of consecutive successes to mark healthy again */
  healthyThreshold: number;
}

export interface HealthCheckResult {
  deploymentId: string;
  slot: SlotName;
  status: 'healthy' | 'unhealthy' | 'unknown';
  latencyMs: number;
  statusCode?: number;
  error?: string;
  timestamp: Date;
}

export interface MonitoredDeployment {
  deploymentId: string;
  slot: SlotName;
  config: HealthCheckConfig;
  timerId?: ReturnType<typeof setInterval>;
  lastCheck?: HealthCheckResult;
  consecutiveFailures: number;
  consecutiveSuccesses: number;
}

export interface HealthStatus {
  deploymentId: string;
  slots: {
    slot: SlotName;
    status: 'healthy' | 'unhealthy' | 'unknown';
    consecutiveFailures: number;
    lastCheck: Date | null;
    latencyMs: number | null;
  }[];
}

// =============================================================================
// Default Configuration
// =============================================================================

const DEFAULT_HEALTH_CONFIG: HealthCheckConfig = {
  endpoint: '/healthz',
  intervalSeconds: 30,
  timeoutSeconds: 10,
  unhealthyThreshold: 3,
  healthyThreshold: 2,
};

// =============================================================================
// Health Monitor Service
// =============================================================================

export function createHealthMonitor(
  prisma: PrismaClient,
  options?: {
    onUnhealthy?: (deploymentId: string, slot: SlotName, result: HealthCheckResult) => void;
    onHealthy?: (deploymentId: string, slot: SlotName) => void;
    onAutoRollback?: (deploymentId: string, fromSlot: SlotName, toSlot: SlotName) => void;
    /** Optional shared deploymentManager instance (created if not provided) */
    deploymentManager?: DeploymentManager;
  }
) {
  // Active monitors
  const monitors = new Map<string, MonitoredDeployment>();
  // Use provided deploymentManager or create new one
  const deploymentManager = options?.deploymentManager ?? createDeploymentManager(prisma);

  /**
   * Generate a unique key for a slot
   */
  function getMonitorKey(deploymentId: string, slot: SlotName): string {
    return `${deploymentId}:${slot}`;
  }

  /**
   * Perform a single health check
   */
  async function performHealthCheck(
    deploymentId: string,
    slot: SlotName,
    config: HealthCheckConfig
  ): Promise<HealthCheckResult> {
    const slotData = await prisma.pluginDeploymentSlot.findUnique({
      where: { deploymentId_slot: { deploymentId, slot } },
    });

    const result: HealthCheckResult = {
      deploymentId,
      slot,
      status: 'unknown',
      latencyMs: 0,
      timestamp: new Date(),
    };

    // No backend URL means frontend-only plugin - always healthy
    if (!slotData?.backendUrl) {
      result.status = 'healthy';
      return result;
    }

    // Skip if slot is not active or deploying
    if (slotData.status !== 'active' && slotData.status !== 'deploying') {
      result.status = 'unknown';
      return result;
    }

    const startTime = Date.now();
    const url = `${slotData.backendUrl}${config.endpoint}`;

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), config.timeoutSeconds * 1000);

      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'HealthMonitor/1.0',
          'X-Health-Check': 'true',
        },
      });

      clearTimeout(timeoutId);

      result.latencyMs = Date.now() - startTime;
      result.statusCode = response.status;

      if (response.ok) {
        // Check response body if it's JSON
        try {
          const body = await response.json();
          if (body.status === 'healthy' || body.status === 'ok' || body.healthy === true) {
            result.status = 'healthy';
          } else if (body.status === 'unhealthy' || body.healthy === false) {
            result.status = 'unhealthy';
            result.error = body.message || 'Service reported unhealthy';
          } else {
            // 2xx response without explicit status is considered healthy
            result.status = 'healthy';
          }
        } catch {
          // Non-JSON 2xx response is considered healthy
          result.status = 'healthy';
        }
      } else {
        result.status = 'unhealthy';
        result.error = `HTTP ${response.status}`;
      }
    } catch (error) {
      result.latencyMs = Date.now() - startTime;
      result.status = 'unhealthy';

      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          result.error = 'Timeout';
        } else {
          result.error = error.message;
        }
      } else {
        result.error = 'Unknown error';
      }
    }

    return result;
  }

  /**
   * Process health check result and update state
   */
  async function processHealthCheckResult(
    monitorKey: string,
    result: HealthCheckResult
  ): Promise<void> {
    const monitor = monitors.get(monitorKey);
    if (!monitor) return;

    monitor.lastCheck = result;

    // Update consecutive counters
    if (result.status === 'healthy') {
      monitor.consecutiveFailures = 0;
      monitor.consecutiveSuccesses++;
    } else if (result.status === 'unhealthy') {
      monitor.consecutiveSuccesses = 0;
      monitor.consecutiveFailures++;
    }

    // Update slot health status in database
    await prisma.pluginDeploymentSlot.update({
      where: {
        deploymentId_slot: {
          deploymentId: result.deploymentId,
          slot: result.slot,
        },
      },
      data: {
        healthStatus: result.status,
        lastHealthCheck: result.timestamp,
        healthCheckFailures: monitor.consecutiveFailures,
      },
    });

    // Record health check metric only on status changes or every 5 checks
    // to prevent database flooding while still capturing important data
    const shouldRecordMetric =
      monitor.consecutiveFailures === 1 || // First failure
      monitor.consecutiveSuccesses === 1 || // First success after failures
      (monitor.consecutiveSuccesses % 5 === 0 && monitor.consecutiveSuccesses > 0); // Every 5th success

    if (shouldRecordMetric) {
      await prisma.pluginMetrics.create({
        data: {
          deploymentId: result.deploymentId,
          slot: result.slot,
          requestCount: 1,
          errorCount: result.status === 'unhealthy' ? 1 : 0,
          latencyP50: result.latencyMs,
          latencyAvg: result.latencyMs,
        },
      });
    }

    // Check for threshold breaches
    if (monitor.consecutiveFailures >= monitor.config.unhealthyThreshold) {
      // Trigger unhealthy callback
      options?.onUnhealthy?.(result.deploymentId, result.slot, result);

      // Check if auto-rollback should be triggered
      await handleUnhealthySlot(result.deploymentId, result.slot);
    } else if (
      monitor.consecutiveSuccesses >= monitor.config.healthyThreshold &&
      result.status === 'healthy'
    ) {
      // Trigger healthy callback
      options?.onHealthy?.(result.deploymentId, result.slot);
    }
  }

  /**
   * Handle unhealthy slot - potentially trigger rollback
   */
  async function handleUnhealthySlot(
    deploymentId: string,
    unhealthySlot: SlotName
  ): Promise<void> {
    // Get current slot traffic distribution
    const slots = await prisma.pluginDeploymentSlot.findMany({
      where: { deploymentId },
    });

    const unhealthySlotData = slots.find(s => s.slot === unhealthySlot);
    const otherSlot = slots.find(s => s.slot !== unhealthySlot);

    // Only rollback if the unhealthy slot is receiving traffic
    if (!unhealthySlotData || unhealthySlotData.trafficPercent === 0) {
      return;
    }

    // Check if the other slot is healthy and can take over
    if (!otherSlot || otherSlot.healthStatus !== 'healthy') {
      console.warn(
        `Cannot rollback deployment ${deploymentId}: no healthy slot available`
      );
      return;
    }

    // Check for auto-rollback alert configuration
    const alert = await prisma.pluginAlert.findFirst({
      where: {
        deploymentId,
        metric: 'health_check',
        autoRollback: true,
        enabled: true,
      },
    });

    if (alert) {
      console.log(
        `Auto-rollback triggered for deployment ${deploymentId}: ` +
          `slot ${unhealthySlot} is unhealthy, rolling back to ${otherSlot.slot}`
      );

      try {
        await deploymentManager.rollback(
          deploymentId,
          'system',
          `Auto-rollback: slot ${unhealthySlot} exceeded unhealthy threshold`
        );

        options?.onAutoRollback?.(
          deploymentId,
          unhealthySlot,
          otherSlot.slot as SlotName
        );
      } catch (error) {
        console.error(`Auto-rollback failed for deployment ${deploymentId}:`, error);
      }
    }
  }

  /**
   * Start a health check timer
   */
  function startMonitorTimer(monitorKey: string): void {
    const monitor = monitors.get(monitorKey);
    if (!monitor || monitor.timerId) return;

    monitor.timerId = setInterval(async () => {
      const result = await performHealthCheck(
        monitor.deploymentId,
        monitor.slot,
        monitor.config
      );
      await processHealthCheckResult(monitorKey, result);
    }, monitor.config.intervalSeconds * 1000);

    // Run immediate first check
    performHealthCheck(monitor.deploymentId, monitor.slot, monitor.config).then(
      result => processHealthCheckResult(monitorKey, result)
    );
  }

  /**
   * Stop a health check timer
   */
  function stopMonitorTimer(monitorKey: string): void {
    const monitor = monitors.get(monitorKey);
    if (monitor?.timerId) {
      clearInterval(monitor.timerId);
      monitor.timerId = undefined;
    }
  }

  // =============================================================================
  // Public API
  // =============================================================================

  return {
    /**
     * Start monitoring a deployment slot
     */
    startMonitoring(
      deploymentId: string,
      slot: SlotName,
      config?: Partial<HealthCheckConfig>
    ): void {
      const monitorKey = getMonitorKey(deploymentId, slot);

      // Stop existing monitor if any
      this.stopMonitoring(deploymentId, slot);

      const fullConfig: HealthCheckConfig = {
        ...DEFAULT_HEALTH_CONFIG,
        ...config,
      };

      monitors.set(monitorKey, {
        deploymentId,
        slot,
        config: fullConfig,
        consecutiveFailures: 0,
        consecutiveSuccesses: 0,
      });

      startMonitorTimer(monitorKey);
    },

    /**
     * Stop monitoring a deployment slot
     */
    stopMonitoring(deploymentId: string, slot: SlotName): void {
      const monitorKey = getMonitorKey(deploymentId, slot);
      stopMonitorTimer(monitorKey);
      monitors.delete(monitorKey);
    },

    /**
     * Stop all monitoring for a deployment
     */
    stopAllMonitoring(deploymentId: string): void {
      this.stopMonitoring(deploymentId, 'blue');
      this.stopMonitoring(deploymentId, 'green');
    },

    /**
     * Perform a single health check (manual check)
     */
    async checkHealth(
      deploymentId: string,
      slot: SlotName,
      config?: Partial<HealthCheckConfig>
    ): Promise<HealthCheckResult> {
      const fullConfig: HealthCheckConfig = {
        ...DEFAULT_HEALTH_CONFIG,
        ...config,
      };

      return performHealthCheck(deploymentId, slot, fullConfig);
    },

    /**
     * Get health status for a deployment
     */
    async getHealthStatus(deploymentId: string): Promise<HealthStatus> {
      const slots = await prisma.pluginDeploymentSlot.findMany({
        where: { deploymentId },
      });

      return {
        deploymentId,
        slots: slots.map(s => {
          const monitorKey = getMonitorKey(deploymentId, s.slot as SlotName);
          const monitor = monitors.get(monitorKey);

          return {
            slot: s.slot as SlotName,
            status: (s.healthStatus as 'healthy' | 'unhealthy' | 'unknown') || 'unknown',
            consecutiveFailures: monitor?.consecutiveFailures || s.healthCheckFailures,
            lastCheck: s.lastHealthCheck,
            latencyMs: monitor?.lastCheck?.latencyMs || null,
          };
        }),
      };
    },

    /**
     * Get all active monitors
     */
    getActiveMonitors(): {
      deploymentId: string;
      slot: SlotName;
      intervalSeconds: number;
    }[] {
      return Array.from(monitors.values())
        .filter(m => m.timerId)
        .map(m => ({
          deploymentId: m.deploymentId,
          slot: m.slot,
          intervalSeconds: m.config.intervalSeconds,
        }));
    },

    /**
     * Check if a slot is being monitored
     */
    isMonitoring(deploymentId: string, slot: SlotName): boolean {
      const monitorKey = getMonitorKey(deploymentId, slot);
      const monitor = monitors.get(monitorKey);
      return !!monitor?.timerId;
    },

    /**
     * Update monitoring configuration for a slot
     */
    updateConfig(
      deploymentId: string,
      slot: SlotName,
      config: Partial<HealthCheckConfig>
    ): void {
      const monitorKey = getMonitorKey(deploymentId, slot);
      const monitor = monitors.get(monitorKey);

      if (monitor) {
        monitor.config = { ...monitor.config, ...config };
        // Restart timer with new config
        stopMonitorTimer(monitorKey);
        startMonitorTimer(monitorKey);
      }
    },

    /**
     * Get default health check configuration
     */
    getDefaultConfig(): HealthCheckConfig {
      return { ...DEFAULT_HEALTH_CONFIG };
    },

    /**
     * Shutdown all monitors (cleanup)
     */
    shutdown(): void {
      Array.from(monitors.keys()).forEach(key => {
        stopMonitorTimer(key);
      });
      monitors.clear();
    },

    /**
     * Get monitor stats for observability
     */
    getStats(): {
      activeMonitors: number;
      totalChecksPerMinute: number;
    } {
      let totalChecksPerMinute = 0;
      let activeCount = 0;

      Array.from(monitors.values()).forEach(monitor => {
        if (monitor.timerId) {
          activeCount++;
          totalChecksPerMinute += 60 / monitor.config.intervalSeconds;
        }
      });

      return {
        activeMonitors: activeCount,
        totalChecksPerMinute,
      };
    },
  };
}

export type HealthMonitor = ReturnType<typeof createHealthMonitor>;
