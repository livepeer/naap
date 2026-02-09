/**
 * Deployment Manager Service
 * Handles advanced deployment strategies: blue-green, canary, and automatic rollback
 *
 * This service extends the base deployment service with production-grade
 * deployment orchestration capabilities.
 */

import { PrismaClient, PluginDeploymentSlot, DeploymentEvent } from '@naap/database';
import {
  SlotName as SharedSlotName,
  isValidDeploymentId,
  isValidVersion,
  isValidTrafficPercent,
  DeploymentNotFoundError,
  InvalidDeploymentIdError,
  ConcurrentDeploymentError,
  InvalidTrafficPercentError,
} from './deploymentTypes';

// =============================================================================
// Types
// =============================================================================

export type SlotName = 'blue' | 'green';
export type SlotStatus = 'active' | 'inactive' | 'deploying' | 'failed' | 'draining';
export type DeploymentEventType =
  | 'deploy_start'
  | 'deploy_complete'
  | 'health_check'
  | 'traffic_shift'
  | 'rollback'
  | 'failure';

export interface DeploymentStrategy {
  type: 'immediate' | 'blue-green' | 'canary';
  canary?: CanaryConfig;
  healthCheck?: HealthCheckConfig;
  rollback?: RollbackConfig;
}

export interface CanaryConfig {
  /** Initial percentage of traffic to route to new version (default: 5) */
  initialPercent: number;
  /** Percentage increment for each step (default: 25) */
  incrementPercent: number;
  /** Interval between increments in seconds (default: 300) */
  intervalSeconds: number;
  /** Success rate threshold (0-1) below which canary is aborted (default: 0.95) */
  successThreshold: number;
}

export interface HealthCheckConfig {
  /** Health check endpoint path (default: /healthz) */
  endpoint: string;
  /** Interval between health checks in seconds (default: 30) */
  intervalSeconds: number;
  /** Timeout for each health check in seconds (default: 10) */
  timeoutSeconds: number;
  /** Number of consecutive failures before marking unhealthy (default: 3) */
  unhealthyThreshold: number;
}

export interface RollbackConfig {
  /** Trigger rollback when error rate exceeds this value (0-1) */
  onErrorRate?: number;
  /** Trigger rollback when p99 latency exceeds this value in ms */
  onLatencyP99?: number;
  /** Trigger rollback on health check failure */
  onHealthCheckFail: boolean;
}

export interface DeployRequest {
  deploymentId: string;
  version: string;
  frontendUrl?: string;
  backendUrl?: string;
  strategy: DeploymentStrategy;
  initiatedBy?: string;
  metadata?: Record<string, unknown>;
}

export interface DeployResult {
  success: boolean;
  deploymentId: string;
  slot: SlotName;
  version: string;
  error?: string;
}

export interface SlotInfo {
  slot: SlotName;
  version: string;
  status: SlotStatus;
  trafficPercent: number;
  healthStatus: string | null;
  frontendUrl: string | null;
  backendUrl: string | null;
  deployedAt: Date | null;
}

export interface DeploymentStatus {
  deploymentId: string;
  activeSlot: SlotName | null;
  activeVersion: string | null;
  slots: SlotInfo[];
  lastEvent: DeploymentEvent | null;
  isDeploying: boolean;
}

// =============================================================================
// Default Configurations
// =============================================================================

const DEFAULT_CANARY_CONFIG: CanaryConfig = {
  initialPercent: 5,
  incrementPercent: 25,
  intervalSeconds: 300,
  successThreshold: 0.95,
};

const DEFAULT_HEALTH_CHECK_CONFIG: HealthCheckConfig = {
  endpoint: '/healthz',
  intervalSeconds: 30,
  timeoutSeconds: 10,
  unhealthyThreshold: 3,
};

const DEFAULT_ROLLBACK_CONFIG: RollbackConfig = {
  onErrorRate: 0.05,
  onLatencyP99: 5000,
  onHealthCheckFail: true,
};

// =============================================================================
// Deployment Manager Service
// =============================================================================

export function createDeploymentManager(prisma: PrismaClient) {
  // In-memory lock for concurrent deployment protection
  // In production, use Redis or database-level locking
  const deploymentLocks = new Set<string>();

  /**
   * Acquire a deployment lock
   * @returns true if lock acquired, false if already locked
   */
  function acquireLock(deploymentId: string): boolean {
    if (deploymentLocks.has(deploymentId)) {
      return false;
    }
    deploymentLocks.add(deploymentId);
    return true;
  }

  /**
   * Release a deployment lock
   */
  function releaseLock(deploymentId: string): void {
    deploymentLocks.delete(deploymentId);
  }

  /**
   * Record a deployment event for audit trail
   */
  async function recordEvent(
    deploymentId: string,
    type: DeploymentEventType,
    details: Partial<Omit<DeploymentEvent, 'id' | 'deploymentId' | 'type' | 'createdAt'>>
  ): Promise<DeploymentEvent> {
    return prisma.deploymentEvent.create({
      data: {
        deploymentId,
        type,
        status: details.status || 'success',
        fromSlot: details.fromSlot,
        toSlot: details.toSlot,
        fromVersion: details.fromVersion,
        toVersion: details.toVersion,
        trafficPercent: details.trafficPercent,
        error: details.error,
        initiatedBy: details.initiatedBy,
        metadata: details.metadata as object,
        duration: details.duration,
      },
    });
  }

  /**
   * Get or initialize deployment slots for a deployment
   */
  async function getOrInitializeSlots(deploymentId: string): Promise<PluginDeploymentSlot[]> {
    const existingSlots = await prisma.pluginDeploymentSlot.findMany({
      where: { deploymentId },
      orderBy: { slot: 'asc' },
    });

    if (existingSlots.length === 2) {
      return existingSlots;
    }

    // Get current deployment version
    const deployment = await prisma.pluginDeployment.findUnique({
      where: { id: deploymentId },
      include: { version: true },
    });

    if (!deployment) {
      throw new Error(`Deployment not found: ${deploymentId}`);
    }

    // Initialize slots if they don't exist
    const slots: PluginDeploymentSlot[] = [];

    for (const slotName of ['blue', 'green'] as SlotName[]) {
      const existing = existingSlots.find(s => s.slot === slotName);
      if (existing) {
        slots.push(existing);
      } else {
        // Create new slot
        const isActiveSlot = slotName === 'blue'; // Default blue as active
        const slot = await prisma.pluginDeploymentSlot.create({
          data: {
            deploymentId,
            slot: slotName,
            version: deployment.version.version,
            status: isActiveSlot ? 'active' : 'inactive',
            trafficPercent: isActiveSlot ? 100 : 0,
            frontendUrl: isActiveSlot ? deployment.frontendUrl : null,
            backendUrl: isActiveSlot ? deployment.backendUrl : null,
            healthStatus: isActiveSlot ? 'healthy' : null,
            deployedAt: isActiveSlot ? deployment.deployedAt : null,
          },
        });
        slots.push(slot);
      }
    }

    return slots.sort((a, b) => a.slot.localeCompare(b.slot));
  }

  /**
   * Get the currently active slot
   */
  async function getActiveSlot(deploymentId: string): Promise<SlotName | null> {
    const activeSlot = await prisma.pluginDeploymentSlot.findFirst({
      where: {
        deploymentId,
        trafficPercent: { gt: 0 },
        status: 'active',
      },
      orderBy: { trafficPercent: 'desc' },
    });

    return activeSlot?.slot as SlotName | null;
  }

  /**
   * Get the target slot for a new deployment (the inactive one)
   */
  async function getTargetSlot(deploymentId: string): Promise<SlotName> {
    const activeSlot = await getActiveSlot(deploymentId);
    return activeSlot === 'blue' ? 'green' : 'blue';
  }

  /**
   * Deploy to a specific slot
   */
  async function deployToSlot(
    deploymentId: string,
    slot: SlotName,
    version: string,
    frontendUrl?: string,
    backendUrl?: string,
    deployedBy?: string
  ): Promise<PluginDeploymentSlot> {
    // Ensure slots are initialized
    await getOrInitializeSlots(deploymentId);

    // Update the target slot with new version
    return prisma.pluginDeploymentSlot.update({
      where: {
        deploymentId_slot: { deploymentId, slot },
      },
      data: {
        version,
        status: 'deploying',
        trafficPercent: 0,
        frontendUrl,
        backendUrl,
        healthStatus: 'unknown',
        healthCheckFailures: 0,
        deployedAt: new Date(),
        deployedBy,
      },
    });
  }

  /**
   * Wait for slot to become healthy
   */
  async function waitForHealthy(
    deploymentId: string,
    slot: SlotName,
    config: HealthCheckConfig,
    maxWaitMs: number = 120000
  ): Promise<boolean> {
    const startTime = Date.now();
    let consecutiveSuccess = 0;
    const requiredSuccess = 2; // Need 2 consecutive successful health checks

    while (Date.now() - startTime < maxWaitMs) {
      const slotData = await prisma.pluginDeploymentSlot.findUnique({
        where: { deploymentId_slot: { deploymentId, slot } },
      });

      if (!slotData?.backendUrl) {
        // No backend, consider healthy (frontend-only plugin)
        await prisma.pluginDeploymentSlot.update({
          where: { deploymentId_slot: { deploymentId, slot } },
          data: { healthStatus: 'healthy', status: 'active' },
        });
        return true;
      }

      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), config.timeoutSeconds * 1000);

        const response = await fetch(`${slotData.backendUrl}${config.endpoint}`, {
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (response.ok) {
          consecutiveSuccess++;
          await prisma.pluginDeploymentSlot.update({
            where: { deploymentId_slot: { deploymentId, slot } },
            data: {
              healthStatus: 'healthy',
              lastHealthCheck: new Date(),
              healthCheckFailures: 0,
            },
          });

          if (consecutiveSuccess >= requiredSuccess) {
            // Mark slot as active (ready for traffic)
            await prisma.pluginDeploymentSlot.update({
              where: { deploymentId_slot: { deploymentId, slot } },
              data: { status: 'active' },
            });
            return true;
          }
        } else {
          consecutiveSuccess = 0;
        }
      } catch (error) {
        consecutiveSuccess = 0;
        await prisma.pluginDeploymentSlot.update({
          where: { deploymentId_slot: { deploymentId, slot } },
          data: {
            lastHealthCheck: new Date(),
            healthCheckFailures: { increment: 1 },
          },
        });
      }

      // Wait before next check
      await new Promise(resolve => setTimeout(resolve, config.intervalSeconds * 1000));
    }

    // Mark slot as failed after timeout
    await prisma.pluginDeploymentSlot.update({
      where: { deploymentId_slot: { deploymentId, slot } },
      data: { status: 'failed', healthStatus: 'unhealthy' },
    });

    return false;
  }

  /**
   * Shift traffic between slots
   */
  async function shiftTraffic(
    deploymentId: string,
    targetSlot: SlotName,
    targetPercent: number,
    initiatedBy?: string
  ): Promise<void> {
    // Validate traffic percentage
    if (!isValidTrafficPercent(targetPercent)) {
      throw new InvalidTrafficPercentError(
        `Invalid traffic percentage: ${targetPercent}. Must be an integer between 0 and 100.`
      );
    }

    const otherSlot: SlotName = targetSlot === 'blue' ? 'green' : 'blue';
    const otherPercent = 100 - targetPercent;

    // Update both slots atomically
    await prisma.$transaction([
      prisma.pluginDeploymentSlot.update({
        where: { deploymentId_slot: { deploymentId, slot: targetSlot } },
        data: { trafficPercent: targetPercent },
      }),
      prisma.pluginDeploymentSlot.update({
        where: { deploymentId_slot: { deploymentId, slot: otherSlot } },
        data: { trafficPercent: otherPercent },
      }),
    ]);

    // Record the traffic shift event
    const slots = await prisma.pluginDeploymentSlot.findMany({
      where: { deploymentId },
    });
    const targetSlotData = slots.find(s => s.slot === targetSlot);
    const otherSlotData = slots.find(s => s.slot === otherSlot);

    await recordEvent(deploymentId, 'traffic_shift', {
      fromSlot: otherSlot,
      toSlot: targetSlot,
      fromVersion: otherSlotData?.version,
      toVersion: targetSlotData?.version,
      trafficPercent: targetPercent,
      initiatedBy,
    });
  }

  /**
   * Execute canary deployment strategy
   */
  async function executeCanary(
    deploymentId: string,
    targetSlot: SlotName,
    config: CanaryConfig,
    initiatedBy?: string
  ): Promise<{ success: boolean; error?: string }> {
    let currentPercent = config.initialPercent;

    while (currentPercent < 100) {
      // Shift traffic to canary percentage
      await shiftTraffic(deploymentId, targetSlot, currentPercent, initiatedBy);

      // Wait for observation period
      await new Promise(resolve =>
        setTimeout(resolve, config.intervalSeconds * 1000)
      );

      // Check metrics during canary (simplified - in production would check real metrics)
      const slotData = await prisma.pluginDeploymentSlot.findUnique({
        where: { deploymentId_slot: { deploymentId, slot: targetSlot } },
      });

      // If health check is failing, abort canary
      if (slotData?.healthStatus === 'unhealthy') {
        return {
          success: false,
          error: `Canary failed: slot ${targetSlot} is unhealthy`,
        };
      }

      // Increment traffic
      currentPercent = Math.min(100, currentPercent + config.incrementPercent);
    }

    // Complete rollout
    await shiftTraffic(deploymentId, targetSlot, 100, initiatedBy);
    return { success: true };
  }

  /**
   * Execute immediate deployment (full traffic switch)
   */
  async function executeImmediate(
    deploymentId: string,
    targetSlot: SlotName,
    initiatedBy?: string
  ): Promise<void> {
    await shiftTraffic(deploymentId, targetSlot, 100, initiatedBy);
  }

  /**
   * Execute blue-green deployment (switch after health check)
   */
  async function executeBlueGreen(
    deploymentId: string,
    targetSlot: SlotName,
    initiatedBy?: string
  ): Promise<void> {
    // For blue-green, we simply switch all traffic at once after health checks pass
    await shiftTraffic(deploymentId, targetSlot, 100, initiatedBy);
  }

  /**
   * Rollback to previous slot
   */
  async function rollback(
    deploymentId: string,
    initiatedBy?: string,
    reason?: string
  ): Promise<{ success: boolean; rolledBackTo: SlotName; version: string }> {
    const slots = await prisma.pluginDeploymentSlot.findMany({
      where: { deploymentId },
    });

    // Find the active slot and the one to rollback to
    const activeSlot = slots.find(s => s.trafficPercent > 50);
    const rollbackSlot = slots.find(s => s.slot !== activeSlot?.slot);

    if (!activeSlot || !rollbackSlot) {
      throw new Error('Cannot determine rollback target');
    }

    const targetSlot = rollbackSlot.slot as SlotName;

    // Record rollback event
    await recordEvent(deploymentId, 'rollback', {
      fromSlot: activeSlot.slot,
      toSlot: targetSlot,
      fromVersion: activeSlot.version,
      toVersion: rollbackSlot.version,
      initiatedBy: initiatedBy || 'system',
      error: reason,
      metadata: { reason, automatic: !initiatedBy },
    });

    // Immediate traffic shift to rollback slot
    await shiftTraffic(deploymentId, targetSlot, 100, initiatedBy || 'system');

    // Mark the failed slot
    await prisma.pluginDeploymentSlot.update({
      where: { deploymentId_slot: { deploymentId, slot: activeSlot.slot } },
      data: { status: 'failed' },
    });

    return {
      success: true,
      rolledBackTo: targetSlot,
      version: rollbackSlot.version,
    };
  }

  // =============================================================================
  // Public API
  // =============================================================================

  return {
    /**
     * Deploy a new version with the specified strategy
     */
    async deploy(request: DeployRequest): Promise<DeployResult> {
      const {
        deploymentId,
        version,
        frontendUrl,
        backendUrl,
        strategy,
        initiatedBy,
        metadata,
      } = request;

      // Input validation
      if (!isValidDeploymentId(deploymentId)) {
        throw new InvalidDeploymentIdError(deploymentId);
      }

      if (!isValidVersion(version)) {
        throw new Error(`Invalid version format: ${version}. Use semver format (e.g., 1.0.0)`);
      }

      // Acquire deployment lock to prevent concurrent deployments
      if (!acquireLock(deploymentId)) {
        throw new ConcurrentDeploymentError(deploymentId);
      }

      let targetSlot: SlotName = 'green'; // Default, will be set in try
      let activeSlot: SlotName | null = null;

      try {
        // Get target slot
        targetSlot = await getTargetSlot(deploymentId);
        activeSlot = await getActiveSlot(deploymentId);

        // Record deployment start
        await recordEvent(deploymentId, 'deploy_start', {
          fromSlot: activeSlot,
          toSlot: targetSlot,
          toVersion: version,
          initiatedBy,
          metadata: metadata as object,
        });

        // 1. Deploy to target slot
        await deployToSlot(
          deploymentId,
          targetSlot,
          version,
          frontendUrl,
          backendUrl,
          initiatedBy
        );

        // 2. Wait for health checks if configured
        const healthConfig = strategy.healthCheck || DEFAULT_HEALTH_CHECK_CONFIG;
        const healthy = await waitForHealthy(deploymentId, targetSlot, healthConfig);

        if (!healthy) {
          await recordEvent(deploymentId, 'failure', {
            toSlot: targetSlot,
            toVersion: version,
            error: 'Health checks failed',
            initiatedBy,
          });

          // Auto-rollback if configured
          if (strategy.rollback?.onHealthCheckFail !== false) {
            await rollback(deploymentId, 'system', 'Health checks failed');
          }

          return {
            success: false,
            deploymentId,
            slot: targetSlot,
            version,
            error: 'Health checks failed',
          };
        }

        // 3. Execute traffic shift based on strategy
        switch (strategy.type) {
          case 'immediate':
            await executeImmediate(deploymentId, targetSlot, initiatedBy);
            break;

          case 'blue-green':
            await executeBlueGreen(deploymentId, targetSlot, initiatedBy);
            break;

          case 'canary':
            const canaryConfig = { ...DEFAULT_CANARY_CONFIG, ...strategy.canary };
            const result = await executeCanary(
              deploymentId,
              targetSlot,
              canaryConfig,
              initiatedBy
            );
            if (!result.success) {
              // Rollback on canary failure
              await rollback(deploymentId, 'system', result.error);
              return {
                success: false,
                deploymentId,
                slot: targetSlot,
                version,
                error: result.error,
              };
            }
            break;
        }

        // 4. Record deployment complete
        await recordEvent(deploymentId, 'deploy_complete', {
          fromSlot: activeSlot,
          toSlot: targetSlot,
          toVersion: version,
          trafficPercent: 100,
          initiatedBy,
        });

        // 5. Mark old slot as inactive
        if (activeSlot) {
          await prisma.pluginDeploymentSlot.update({
            where: { deploymentId_slot: { deploymentId, slot: activeSlot } },
            data: { status: 'inactive' },
          });
        }

        return {
          success: true,
          deploymentId,
          slot: targetSlot,
          version,
        };

      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';

        await recordEvent(deploymentId, 'failure', {
          toSlot: targetSlot,
          toVersion: version,
          error: errorMessage,
          initiatedBy,
        });

        // Attempt rollback
        const rollbackConfig = strategy.rollback || DEFAULT_ROLLBACK_CONFIG;
        if (rollbackConfig.onHealthCheckFail) {
          try {
            await rollback(deploymentId, 'system', errorMessage);
          } catch (rollbackError) {
            console.error('Rollback failed:', rollbackError);
          }
        }

        return {
          success: false,
          deploymentId,
          slot: targetSlot,
          version,
          error: errorMessage,
        };
      } finally {
        // Always release the lock when deployment completes
        releaseLock(deploymentId);
      }
    },

    /**
     * Rollback to the previous version
     */
    async rollback(
      deploymentId: string,
      initiatedBy?: string,
      reason?: string
    ) {
      return rollback(deploymentId, initiatedBy, reason);
    },

    /**
     * Get current deployment status including both slots
     */
    async getStatus(deploymentId: string): Promise<DeploymentStatus> {
      const slots = await getOrInitializeSlots(deploymentId);

      const lastEvent = await prisma.deploymentEvent.findFirst({
        where: { deploymentId },
        orderBy: { createdAt: 'desc' },
      });

      const activeSlotData = slots.find(s => s.trafficPercent > 0 && s.status === 'active');
      const isDeploying = slots.some(s => s.status === 'deploying');

      return {
        deploymentId,
        activeSlot: (activeSlotData?.slot as SlotName) || null,
        activeVersion: activeSlotData?.version || null,
        slots: slots.map(s => ({
          slot: s.slot as SlotName,
          version: s.version,
          status: s.status as SlotStatus,
          trafficPercent: s.trafficPercent,
          healthStatus: s.healthStatus,
          frontendUrl: s.frontendUrl,
          backendUrl: s.backendUrl,
          deployedAt: s.deployedAt,
        })),
        lastEvent,
        isDeploying,
      };
    },

    /**
     * Get deployment history (recent events)
     */
    async getHistory(
      deploymentId: string,
      limit: number = 50
    ): Promise<DeploymentEvent[]> {
      return prisma.deploymentEvent.findMany({
        where: { deploymentId },
        orderBy: { createdAt: 'desc' },
        take: limit,
      });
    },

    /**
     * Manually shift traffic between slots
     */
    async shiftTraffic(
      deploymentId: string,
      targetSlot: SlotName,
      targetPercent: number,
      initiatedBy?: string
    ): Promise<void> {
      return shiftTraffic(deploymentId, targetSlot, targetPercent, initiatedBy);
    },

    /**
     * Get slots for a deployment
     */
    async getSlots(deploymentId: string): Promise<PluginDeploymentSlot[]> {
      return getOrInitializeSlots(deploymentId);
    },

    /**
     * Update slot health status
     */
    async updateSlotHealth(
      deploymentId: string,
      slot: SlotName,
      healthStatus: 'healthy' | 'unhealthy' | 'unknown',
      failures?: number
    ): Promise<void> {
      await prisma.pluginDeploymentSlot.update({
        where: { deploymentId_slot: { deploymentId, slot } },
        data: {
          healthStatus,
          lastHealthCheck: new Date(),
          healthCheckFailures: failures ?? (healthStatus === 'unhealthy' ? { increment: 1 } : 0),
        },
      });
    },

    /**
     * Get slot by deployment and slot name
     */
    async getSlot(
      deploymentId: string,
      slot: SlotName
    ): Promise<PluginDeploymentSlot | null> {
      return prisma.pluginDeploymentSlot.findUnique({
        where: { deploymentId_slot: { deploymentId, slot } },
      });
    },

    /**
     * Record a deployment event manually
     */
    recordEvent,

    /**
     * Get active slot for a deployment
     */
    getActiveSlot,

    /**
     * Get the default configurations
     */
    getDefaults() {
      return {
        canary: DEFAULT_CANARY_CONFIG,
        healthCheck: DEFAULT_HEALTH_CHECK_CONFIG,
        rollback: DEFAULT_ROLLBACK_CONFIG,
      };
    },
  };
}

export type DeploymentManager = ReturnType<typeof createDeploymentManager>;
