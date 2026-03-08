import type { ProviderAdapterRegistry } from './ProviderAdapterRegistry.js';
import type { DeploymentOrchestrator, DeploymentRecord } from './DeploymentOrchestrator.js';
import type { HealthStatus, HealthResult } from '../types/index.js';
import { setSystemUserId } from '../lib/providerFetch.js';

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

    // Monitor ONLINE/DEGRADED/OFFLINE deployments for health, and sync in-progress deployments to advance state
    const online = deployments.filter((d) => ['ONLINE', 'DEGRADED', 'OFFLINE'].includes(d.status));
    const inProgress = deployments.filter(
      (d) => ['DEPLOYING', 'VALIDATING'].includes(d.status) && d.providerDeploymentId,
    );

    await Promise.allSettled([
      ...online.map((d) => this.checkOne(d)),
      ...inProgress.map((d) => this.syncInProgress(d)),
    ]);
  }

  private async syncInProgress(deployment: DeploymentRecord): Promise<void> {
    try {
      await this.orchestrator.syncStatus(deployment.id, 'health-monitor');
    } catch (err: any) {
      console.warn(`[health-monitor] Failed to sync in-progress deployment ${deployment.id}: ${err.message}`);
    }
  }

  async checkOne(deployment: DeploymentRecord): Promise<HealthResult> {
    const adapter = this.registry.get(deployment.providerSlug);

    // Set system userId so authenticatedProviderFetch can look up credentials
    setSystemUserId(deployment.ownerUserId);

    let result: HealthResult;
    try {
      result = await adapter.healthCheck(
        deployment.providerDeploymentId || '',
        deployment.endpointUrl || undefined,
      );
    } catch {
      result = { healthy: false, status: 'RED' };
    } finally {
      setSystemUserId(null);
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

    await this.orchestrator.updateHealthStatus(deployment.id, computedStatus, result.details);
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
