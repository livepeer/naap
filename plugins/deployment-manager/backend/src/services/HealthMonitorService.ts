import type { ProviderAdapterRegistry } from './ProviderAdapterRegistry.js';
import type { DeploymentOrchestrator, DeploymentRecord } from './DeploymentOrchestrator.js';
import type { HealthStatus, HealthResult } from '../types/index.js';

export interface HealthLogEntry {
  id: string;
  deploymentId: string;
  status: HealthStatus;
  responseTime?: number;
  statusCode?: number;
  details?: Record<string, unknown>;
  createdAt: Date;
}

export class HealthMonitorService {
  private intervalMs: number;
  private degradedThresholdMs: number;
  private failureThreshold: number;
  private timer: ReturnType<typeof setInterval> | null = null;
  private consecutiveFailures = new Map<string, number>();
  private healthLogs: HealthLogEntry[] = [];
  private running = false;

  constructor(
    private registry: ProviderAdapterRegistry,
    private orchestrator: DeploymentOrchestrator,
    config?: {
      intervalMs?: number;
      degradedThresholdMs?: number;
      failureThreshold?: number;
    },
  ) {
    this.intervalMs = config?.intervalMs ?? 60_000;
    this.degradedThresholdMs = config?.degradedThresholdMs ?? 5_000;
    this.failureThreshold = config?.failureThreshold ?? 3;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    console.log(`[health-monitor] Started (interval=${this.intervalMs}ms, degraded=${this.degradedThresholdMs}ms, failures=${this.failureThreshold})`);
    this.timer = setInterval(() => this.checkAll(), this.intervalMs);
  }

  stop(): void {
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    console.log('[health-monitor] Stopped');
  }

  async checkAll(): Promise<void> {
    const deployments = await this.orchestrator.list();
    const monitorable = deployments.filter((d) =>
      ['ONLINE', 'DEGRADED', 'OFFLINE'].includes(d.status),
    );

    await Promise.allSettled(
      monitorable.map((d) => this.checkOne(d)),
    );
  }

  async checkOne(deployment: DeploymentRecord): Promise<HealthResult> {
    const adapter = this.registry.get(deployment.providerSlug);

    let result: HealthResult;
    try {
      result = await adapter.healthCheck(
        deployment.providerDeploymentId || '',
        deployment.endpointUrl || undefined,
      );
    } catch {
      result = { healthy: false, status: 'RED' };
    }

    const computedStatus = this.computeStatus(deployment.id, result);
    result.status = computedStatus;

    this.healthLogs.push({
      id: crypto.randomUUID(),
      deploymentId: deployment.id,
      status: computedStatus,
      responseTime: result.responseTimeMs,
      statusCode: result.statusCode,
      details: result.details,
      createdAt: new Date(),
    });

    // Evict old logs (keep last 1000 per deployment)
    this.evictOldLogs(deployment.id, 1000);

    this.orchestrator.updateHealthStatus(deployment.id, computedStatus);
    return result;
  }

  async checkById(deploymentId: string): Promise<HealthResult | null> {
    const deployment = await this.orchestrator.get(deploymentId);
    if (!deployment) return null;
    return this.checkOne(deployment);
  }

  getHealthLogs(deploymentId: string, limit = 50): HealthLogEntry[] {
    return this.healthLogs
      .filter((l) => l.deploymentId === deploymentId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit);
  }

  private computeStatus(deploymentId: string, result: HealthResult): HealthStatus {
    if (result.healthy) {
      this.consecutiveFailures.set(deploymentId, 0);
      if (result.responseTimeMs && result.responseTimeMs > this.degradedThresholdMs) {
        return 'ORANGE';
      }
      return 'GREEN';
    }

    const failures = (this.consecutiveFailures.get(deploymentId) || 0) + 1;
    this.consecutiveFailures.set(deploymentId, failures);

    if (failures >= this.failureThreshold) {
      return 'RED';
    }
    return 'ORANGE';
  }

  private evictOldLogs(deploymentId: string, maxPerDeployment: number): void {
    const logsForDeployment = this.healthLogs.filter((l) => l.deploymentId === deploymentId);
    if (logsForDeployment.length > maxPerDeployment) {
      const cutoff = logsForDeployment
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        [maxPerDeployment - 1].createdAt;
      this.healthLogs = this.healthLogs.filter(
        (l) => l.deploymentId !== deploymentId || l.createdAt >= cutoff,
      );
    }
  }
}
