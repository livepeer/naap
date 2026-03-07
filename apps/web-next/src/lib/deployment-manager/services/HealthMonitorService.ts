import type { ProviderAdapterRegistry } from './ProviderAdapterRegistry';
import type { DeploymentOrchestrator } from './DeploymentOrchestrator';
import type { HealthStatus, HealthResult, DeploymentRecord } from '../types';
import { prisma } from '@/lib/db';
import { setCurrentUserId } from '../provider-fetch';

export class HealthMonitorService {
  private degradedThresholdMs: number;
  private failureThreshold: number;
  private consecutiveFailures = new Map<string, number>();

  constructor(
    private registry: ProviderAdapterRegistry,
    private orchestrator: DeploymentOrchestrator,
    config?: { degradedThresholdMs?: number; failureThreshold?: number },
  ) {
    this.degradedThresholdMs = config?.degradedThresholdMs ?? 5_000;
    this.failureThreshold = config?.failureThreshold ?? 3;
  }

  async checkAll(): Promise<void> {
    const deployments = await this.orchestrator.list();
    const monitorable = deployments.filter((d) => ['ONLINE', 'DEGRADED', 'OFFLINE'].includes(d.status));
    await Promise.allSettled(monitorable.map((d) => this.checkOne(d)));
  }

  async checkOne(deployment: DeploymentRecord): Promise<HealthResult> {
    const adapter = this.registry.get(deployment.providerSlug);
    let result: HealthResult;
    setCurrentUserId(deployment.ownerUserId);
    try {
      result = await adapter.healthCheck(deployment.providerDeploymentId || '', deployment.endpointUrl || undefined);
    } catch {
      result = { healthy: false, status: 'RED' };
    } finally {
      setCurrentUserId(null);
    }

    const computedStatus = this.computeStatus(deployment.id, result);
    result.status = computedStatus;

    try {
      await prisma.dmHealthLog.create({
        data: {
          deploymentId: deployment.id,
          status: computedStatus,
          responseTime: result.responseTimeMs,
          statusCode: result.statusCode,
          details: result.details as any,
        },
      });
    } catch (err) {
      console.error('[health-monitor] Failed to persist health log:', err);
    }

    this.orchestrator.updateHealthStatus(deployment.id, computedStatus);
    return result;
  }

  async checkById(deploymentId: string): Promise<HealthResult | null> {
    const deployment = await this.orchestrator.get(deploymentId);
    if (!deployment) return null;
    return this.checkOne(deployment);
  }

  async getHealthLogs(deploymentId: string, limit = 50) {
    return prisma.dmHealthLog.findMany({
      where: { deploymentId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  private computeStatus(deploymentId: string, result: HealthResult): HealthStatus {
    if (result.healthy) {
      this.consecutiveFailures.set(deploymentId, 0);
      if (result.responseTimeMs && result.responseTimeMs > this.degradedThresholdMs) return 'ORANGE';
      return 'GREEN';
    }
    const failures = (this.consecutiveFailures.get(deploymentId) || 0) + 1;
    this.consecutiveFailures.set(deploymentId, failures);
    return failures >= this.failureThreshold ? 'RED' : 'ORANGE';
  }
}
