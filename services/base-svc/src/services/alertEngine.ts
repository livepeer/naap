/**
 * Alert Engine Service
 * Monitors plugin metrics and triggers alerts based on configured conditions
 *
 * Features:
 * - Configurable alert conditions (error rate, latency, health)
 * - Multiple notification channels (Slack, email, webhook)
 * - Cooldown periods to prevent alert storms
 * - Auto-rollback trigger integration
 * - Alert history tracking
 */

import { PrismaClient, PluginAlert } from '@naap/database';
import { createMetricsCollector, AggregatedMetrics } from './metricsCollector';
import { createDeploymentManager, DeploymentManager } from './deploymentManager';
import { isValidDeploymentId, InvalidDeploymentIdError } from './deploymentTypes';

// =============================================================================
// Types
// =============================================================================

export type AlertMetric =
  | 'error_rate'
  | 'latency_p99'
  | 'latency_p95'
  | 'latency_avg'
  | 'health_check'
  | 'cpu_usage'
  | 'memory_usage';

export type AlertOperator = 'gt' | 'gte' | 'lt' | 'lte' | 'eq';

export type AlertSeverity = 'critical' | 'warning' | 'info';

export interface AlertCondition {
  metric: AlertMetric;
  operator: AlertOperator;
  threshold: number;
  duration: number; // seconds
}

export interface NotificationChannel {
  type: 'slack' | 'email' | 'webhook';
  config: {
    url?: string; // For Slack/webhook
    address?: string; // For email
    headers?: Record<string, string>; // For webhook
  };
}

export interface AlertConfig {
  deploymentId: string;
  name: string;
  description?: string;
  condition: AlertCondition;
  severity: AlertSeverity;
  channels: NotificationChannel[];
  autoRollback?: boolean;
  cooldownSeconds?: number;
}

export interface AlertTriggerEvent {
  alertId: string;
  alertName: string;
  deploymentId: string;
  severity: AlertSeverity;
  condition: string;
  currentValue: number;
  threshold: number;
  timestamp: Date;
}

export interface AlertCallbacks {
  onTrigger?: (event: AlertTriggerEvent) => void;
  onResolve?: (alertId: string, deploymentId: string) => void;
  onRollback?: (deploymentId: string, reason: string) => void;
}

// In-memory state for condition tracking
interface ConditionState {
  alertId: string;
  conditionMetSince: Date | null;
  lastValue: number | null;
}

// =============================================================================
// Alert Engine Service
// =============================================================================

export function createAlertEngine(
  prisma: PrismaClient,
  callbacks?: AlertCallbacks
) {
  const metricsCollector = createMetricsCollector(prisma);
  const deploymentManager = createDeploymentManager(prisma);

  // Track condition states for duration-based alerting
  const conditionStates = new Map<string, ConditionState>();

  // Active evaluation timers
  const evaluationTimers = new Map<string, ReturnType<typeof setInterval>>();

  /**
   * Get metric value from aggregated metrics
   * Note: health_check is handled separately via checkCondition method
   */
  function getMetricValue(metric: AlertMetric, metrics: AggregatedMetrics): number {
    switch (metric) {
      case 'error_rate':
        return metrics.errorRate;
      case 'latency_p99':
        return metrics.latencyP99;
      case 'latency_p95':
        return metrics.latencyP95;
      case 'latency_avg':
        return metrics.latencyAvg;
      case 'cpu_usage':
        return metrics.cpuUsagePercent || 0;
      case 'memory_usage':
        return metrics.memoryUsageMb || 0;
      case 'health_check':
        // Health check returns error count as the metric value
        // 0 = healthy, >0 = number of consecutive failures
        return metrics.errorCount;
      default:
        return 0;
    }
  }

  /**
   * Evaluate condition operator
   */
  function evaluateOperator(
    value: number,
    operator: AlertOperator,
    threshold: number
  ): boolean {
    switch (operator) {
      case 'gt':
        return value > threshold;
      case 'gte':
        return value >= threshold;
      case 'lt':
        return value < threshold;
      case 'lte':
        return value <= threshold;
      case 'eq':
        return value === threshold;
      default:
        return false;
    }
  }

  /**
   * Format condition as human-readable string
   */
  function formatCondition(alert: PluginAlert): string {
    const operatorMap: Record<string, string> = {
      gt: '>',
      gte: '>=',
      lt: '<',
      lte: '<=',
      eq: '=',
    };
    return `${alert.metric} ${operatorMap[alert.operator] || alert.operator} ${alert.threshold}`;
  }

  /**
   * Send notification to a channel
   */
  async function sendNotification(
    channel: NotificationChannel,
    event: AlertTriggerEvent
  ): Promise<void> {
    const payload = {
      alert: event.alertName,
      severity: event.severity,
      deploymentId: event.deploymentId,
      condition: event.condition,
      currentValue: event.currentValue,
      threshold: event.threshold,
      timestamp: event.timestamp.toISOString(),
    };

    try {
      switch (channel.type) {
        case 'slack':
          if (channel.config.url) {
            await fetch(channel.config.url, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                text: `:warning: *Alert: ${event.alertName}*`,
                attachments: [
                  {
                    color:
                      event.severity === 'critical'
                        ? 'danger'
                        : event.severity === 'warning'
                          ? 'warning'
                          : 'good',
                    fields: [
                      { title: 'Condition', value: event.condition, short: true },
                      {
                        title: 'Current Value',
                        value: event.currentValue.toFixed(2),
                        short: true,
                      },
                      {
                        title: 'Threshold',
                        value: event.threshold.toString(),
                        short: true,
                      },
                      { title: 'Severity', value: event.severity, short: true },
                    ],
                  },
                ],
              }),
            });
          }
          break;

        case 'webhook':
          if (channel.config.url) {
            await fetch(channel.config.url, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                ...channel.config.headers,
              },
              body: JSON.stringify(payload),
            });
          }
          break;

        case 'email':
          // In production, would use SendGrid or similar
          console.log(`Email alert to ${channel.config.address}:`, payload);
          break;
      }
    } catch (error) {
      console.error(`Failed to send ${channel.type} notification:`, error);
    }
  }

  /**
   * Trigger an alert
   */
  async function triggerAlert(
    alert: PluginAlert,
    currentValue: number
  ): Promise<void> {
    // Check cooldown
    if (alert.lastTriggeredAt) {
      const cooldownMs = (alert.cooldownSeconds || 300) * 1000;
      const timeSinceLastTrigger = Date.now() - alert.lastTriggeredAt.getTime();
      if (timeSinceLastTrigger < cooldownMs) {
        return;
      }
    }

    // Update alert state
    await prisma.pluginAlert.update({
      where: { id: alert.id },
      data: {
        lastTriggeredAt: new Date(),
        triggerCount: { increment: 1 },
      },
    });

    const event: AlertTriggerEvent = {
      alertId: alert.id,
      alertName: alert.name,
      deploymentId: alert.deploymentId,
      severity: alert.severity as AlertSeverity,
      condition: formatCondition(alert),
      currentValue,
      threshold: alert.threshold,
      timestamp: new Date(),
    };

    // Invoke callback
    callbacks?.onTrigger?.(event);

    // Send notifications to all channels
    const channels = (alert.channels as unknown as NotificationChannel[]) || [];
    await Promise.all(channels.map(channel => sendNotification(channel, event)));

    // Trigger auto-rollback if configured
    if (alert.autoRollback) {
      try {
        await deploymentManager.rollback(
          alert.deploymentId,
          'system',
          `Auto-rollback triggered by alert: ${alert.name}`
        );
        callbacks?.onRollback?.(alert.deploymentId, alert.name);
      } catch (error) {
        console.error(`Auto-rollback failed for ${alert.deploymentId}:`, error);
      }
    }
  }

  /**
   * Resolve an alert
   */
  async function resolveAlert(alert: PluginAlert): Promise<void> {
    const state = conditionStates.get(alert.id);
    if (state?.conditionMetSince) {
      conditionStates.set(alert.id, {
        ...state,
        conditionMetSince: null,
      });

      await prisma.pluginAlert.update({
        where: { id: alert.id },
        data: { lastResolvedAt: new Date() },
      });

      callbacks?.onResolve?.(alert.id, alert.deploymentId);
    }
  }

  /**
   * Evaluate a single alert condition
   */
  async function evaluateAlert(alert: PluginAlert): Promise<void> {
    if (!alert.enabled) return;

    // Get recent metrics (last 5 minutes)
    const metrics = await metricsCollector.getRecentMetrics(alert.deploymentId, 5);

    // Get metric value
    const currentValue = getMetricValue(alert.metric as AlertMetric, metrics);

    // Evaluate condition
    const conditionMet = evaluateOperator(
      currentValue,
      alert.operator as AlertOperator,
      alert.threshold
    );

    // Get or create condition state
    let state = conditionStates.get(alert.id);
    if (!state) {
      state = {
        alertId: alert.id,
        conditionMetSince: null,
        lastValue: null,
      };
      conditionStates.set(alert.id, state);
    }

    state.lastValue = currentValue;

    if (conditionMet) {
      if (!state.conditionMetSince) {
        // Condition just started being met
        state.conditionMetSince = new Date();
      } else {
        // Check if duration threshold is met
        const durationMs = Date.now() - state.conditionMetSince.getTime();
        if (durationMs >= (alert.duration || 60) * 1000) {
          await triggerAlert(alert, currentValue);
        }
      }
    } else {
      // Condition no longer met - resolve if it was active
      if (state.conditionMetSince) {
        await resolveAlert(alert);
      }
    }
  }

  /**
   * Evaluate all alerts for a deployment
   */
  async function evaluateDeploymentAlerts(deploymentId: string): Promise<void> {
    const alerts = await prisma.pluginAlert.findMany({
      where: { deploymentId, enabled: true },
    });

    await Promise.all(alerts.map(alert => evaluateAlert(alert)));
  }

  // =============================================================================
  // Public API
  // =============================================================================

  return {
    /**
     * Create a new alert
     */
    async createAlert(config: AlertConfig): Promise<PluginAlert> {
      // Validate deployment ID
      if (!isValidDeploymentId(config.deploymentId)) {
        throw new InvalidDeploymentIdError(config.deploymentId);
      }

      // Validate threshold is a positive number
      if (typeof config.condition.threshold !== 'number' || config.condition.threshold < 0) {
        throw new Error('Alert threshold must be a non-negative number');
      }

      // Validate duration is positive
      if (config.condition.duration <= 0) {
        throw new Error('Alert duration must be a positive number');
      }

      return prisma.pluginAlert.create({
        data: {
          deploymentId: config.deploymentId,
          name: config.name,
          description: config.description,
          metric: config.condition.metric,
          operator: config.condition.operator,
          threshold: config.condition.threshold,
          duration: config.condition.duration,
          severity: config.severity,
          autoRollback: config.autoRollback || false,
          channels: config.channels as object[],
          cooldownSeconds: config.cooldownSeconds || 300,
          enabled: true,
        },
      });
    },

    /**
     * Update an alert
     */
    async updateAlert(
      alertId: string,
      updates: Partial<AlertConfig>
    ): Promise<PluginAlert> {
      const data: Record<string, unknown> = {};

      if (updates.name) data.name = updates.name;
      if (updates.description !== undefined) data.description = updates.description;
      if (updates.condition) {
        data.metric = updates.condition.metric;
        data.operator = updates.condition.operator;
        data.threshold = updates.condition.threshold;
        data.duration = updates.condition.duration;
      }
      if (updates.severity) data.severity = updates.severity;
      if (updates.channels) data.channels = updates.channels as object[];
      if (updates.autoRollback !== undefined) data.autoRollback = updates.autoRollback;
      if (updates.cooldownSeconds) data.cooldownSeconds = updates.cooldownSeconds;

      return prisma.pluginAlert.update({
        where: { id: alertId },
        data,
      });
    },

    /**
     * Delete an alert
     */
    async deleteAlert(alertId: string): Promise<void> {
      await prisma.pluginAlert.delete({
        where: { id: alertId },
      });
      conditionStates.delete(alertId);
    },

    /**
     * Enable/disable an alert
     */
    async setAlertEnabled(alertId: string, enabled: boolean): Promise<void> {
      await prisma.pluginAlert.update({
        where: { id: alertId },
        data: { enabled },
      });
    },

    /**
     * Get all alerts for a deployment
     */
    async getAlerts(deploymentId: string): Promise<PluginAlert[]> {
      return prisma.pluginAlert.findMany({
        where: { deploymentId },
        orderBy: { createdAt: 'desc' },
      });
    },

    /**
     * Get active (triggered) alerts for a deployment
     */
    async getActiveAlerts(deploymentId: string): Promise<PluginAlert[]> {
      const alerts = await prisma.pluginAlert.findMany({
        where: { deploymentId, enabled: true },
      });

      return alerts.filter(alert => {
        const state = conditionStates.get(alert.id);
        return state?.conditionMetSince !== null;
      });
    },

    /**
     * Start monitoring a deployment
     */
    startMonitoring(deploymentId: string, intervalSeconds: number = 60): void {
      // Stop existing monitoring if any
      this.stopMonitoring(deploymentId);

      const timer = setInterval(async () => {
        try {
          await evaluateDeploymentAlerts(deploymentId);
        } catch (error) {
          console.error(`Alert evaluation failed for ${deploymentId}:`, error);
        }
      }, intervalSeconds * 1000);

      evaluationTimers.set(deploymentId, timer);

      // Run immediate evaluation
      evaluateDeploymentAlerts(deploymentId).catch(console.error);
    },

    /**
     * Stop monitoring a deployment
     */
    stopMonitoring(deploymentId: string): void {
      const timer = evaluationTimers.get(deploymentId);
      if (timer) {
        clearInterval(timer);
        evaluationTimers.delete(deploymentId);
      }
    },

    /**
     * Manually check a specific condition
     */
    async checkCondition(
      deploymentId: string,
      metric: AlertMetric,
      context?: { error?: string }
    ): Promise<void> {
      // Find alerts matching this metric
      const alerts = await prisma.pluginAlert.findMany({
        where: { deploymentId, metric, enabled: true },
      });

      for (const alert of alerts) {
        if (metric === 'health_check' && context?.error) {
          // Health check failure - trigger immediately
          await triggerAlert(alert, 1);
        } else {
          await evaluateAlert(alert);
        }
      }
    },

    /**
     * Get alert statistics
     */
    async getStats(deploymentId?: string): Promise<{
      total: number;
      enabled: number;
      triggered: number;
      bySeverity: Record<string, number>;
    }> {
      const where = deploymentId ? { deploymentId } : {};

      const [total, enabled, bySeverity] = await Promise.all([
        prisma.pluginAlert.count({ where }),
        prisma.pluginAlert.count({ where: { ...where, enabled: true } }),
        prisma.pluginAlert.groupBy({
          by: ['severity'],
          where,
          _count: true,
        }),
      ]);

      // Count currently triggered alerts
      let triggered = 0;
      Array.from(conditionStates.values()).forEach(state => {
        if (state.conditionMetSince) triggered++;
      });

      return {
        total,
        enabled,
        triggered,
        bySeverity: Object.fromEntries(
          bySeverity.map(g => [g.severity, g._count])
        ),
      };
    },

    /**
     * Shutdown alert engine
     */
    shutdown(): void {
      Array.from(evaluationTimers.values()).forEach(timer => {
        clearInterval(timer);
      });
      evaluationTimers.clear();
      conditionStates.clear();
    },
  };
}

export type AlertEngine = ReturnType<typeof createAlertEngine>;
