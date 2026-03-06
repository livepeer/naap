import { describe, it, expect, beforeEach } from 'vitest';
import { HealthMonitorService } from '../../services/HealthMonitorService.js';
import { DeploymentOrchestrator } from '../../services/DeploymentOrchestrator.js';
import { ProviderAdapterRegistry } from '../../services/ProviderAdapterRegistry.js';
import { AuditService } from '../../services/AuditService.js';
import { InMemoryDeploymentStore } from '../../store/InMemoryDeploymentStore.js';
import type { IProviderAdapter } from '../../adapters/IProviderAdapter.js';
import type { DeployConfig, UpdateConfig, HealthResult } from '../../types/index.js';

class MockAdapter implements IProviderAdapter {
  readonly slug = 'mock';
  readonly displayName = 'Mock';
  readonly mode = 'serverless' as const;
  readonly icon = '🧪';
  readonly description = 'Mock';
  readonly authMethod = 'api-key';
  readonly apiConfig = { upstreamBaseUrl: 'http://mock', authType: 'bearer' as const, secretNames: ['api-key'], healthCheckPath: null };
  shouldFail = false;
  healthResult: HealthResult = { healthy: true, status: 'GREEN', responseTimeMs: 50 };
  deployCallCount = 0;

  async getGpuOptions() { return [{ id: 'gpu', name: 'GPU', vramGb: 80, available: true }]; }
  async deploy(config: DeployConfig) {
    this.deployCallCount++;
    if (this.shouldFail) throw new Error('Mock deploy failure');
    return { providerDeploymentId: 'mock-123', endpointUrl: 'https://mock/endpoint', status: 'DEPLOYING' as const };
  }
  async getStatus() { return { status: 'ONLINE' as const }; }
  async destroy() {}
  async update(_id: string, _config: UpdateConfig) { return { providerDeploymentId: 'mock-123', status: 'UPDATING' as const }; }
  async healthCheck() { return this.healthResult; }
}

const baseConfig: DeployConfig = {
  name: 'test', providerSlug: 'mock', gpuModel: 'A100', gpuVramGb: 80, gpuCount: 1,
  artifactType: 'ai-runner', artifactVersion: 'v1.0.0', dockerImage: 'livepeer/ai-runner:v1.0.0',
};

describe('Feature: Health Monitoring Pipeline', () => {
  let monitor: HealthMonitorService;
  let orchestrator: DeploymentOrchestrator;
  let registry: ProviderAdapterRegistry;
  let audit: AuditService;
  let adapter: MockAdapter;

  beforeEach(() => {
    registry = new ProviderAdapterRegistry();
    adapter = new MockAdapter();
    registry.register(adapter);
    audit = new AuditService();
    orchestrator = new DeploymentOrchestrator(registry, audit, new InMemoryDeploymentStore());
    monitor = new HealthMonitorService(registry, orchestrator, {
      intervalMs: 60_000,
      degradedThresholdMs: 500,
      failureThreshold: 3,
    });
  });

  it('Given a healthy ONLINE deployment with fast response, When a health check runs, Then the status is GREEN', async () => {
    // Given
    const deployment = await orchestrator.create(baseConfig, 'user-1');
    await orchestrator.deploy(deployment.id, 'user-1');
    const record = await orchestrator.get(deployment.id);
    (record as any).status = 'ONLINE';
    (record as any).providerDeploymentId = 'test';
    adapter.healthResult = { healthy: true, status: 'GREEN', responseTimeMs: 50 };

    // When
    const result = await monitor.checkOne(record!);

    // Then
    expect(result.status).toBe('GREEN');
    expect(result.healthy).toBe(true);

    const updatedRecord = await orchestrator.get(deployment.id);
    expect(updatedRecord?.healthStatus).toBe('GREEN');

    const logs = monitor.getHealthLogs(deployment.id);
    expect(logs.length).toBe(1);
    expect(logs[0].status).toBe('GREEN');
  });

  it('Given a healthy ONLINE deployment with slow response, When a health check runs, Then the status is ORANGE (degraded)', async () => {
    // Given
    const deployment = await orchestrator.create(baseConfig, 'user-1');
    await orchestrator.deploy(deployment.id, 'user-1');
    const record = await orchestrator.get(deployment.id);
    (record as any).status = 'ONLINE';
    (record as any).providerDeploymentId = 'test';
    adapter.healthResult = { healthy: true, status: 'GREEN', responseTimeMs: 1500 };

    // When
    const result = await monitor.checkOne(record!);

    // Then — responseTimeMs (1500) > degradedThresholdMs (500) → ORANGE
    expect(result.status).toBe('ORANGE');
    expect(result.healthy).toBe(true);

    const updatedRecord = await orchestrator.get(deployment.id);
    expect(updatedRecord?.healthStatus).toBe('ORANGE');
  });

  it('Given an ONLINE deployment, When health checks fail 3 consecutive times (failureThreshold=3), Then the status transitions to RED', async () => {
    // Given
    const deployment = await orchestrator.create(baseConfig, 'user-1');
    await orchestrator.deploy(deployment.id, 'user-1');
    const record = await orchestrator.get(deployment.id);
    (record as any).status = 'ONLINE';
    (record as any).providerDeploymentId = 'test';
    adapter.healthResult = { healthy: false, status: 'RED' };

    // When — first two failures should be ORANGE (below threshold)
    const result1 = await monitor.checkOne(record!);
    expect(result1.status).toBe('ORANGE');

    const result2 = await monitor.checkOne(record!);
    expect(result2.status).toBe('ORANGE');

    // Third failure crosses the threshold
    const result3 = await monitor.checkOne(record!);

    // Then
    expect(result3.status).toBe('RED');

    const updatedRecord = await orchestrator.get(deployment.id);
    expect(updatedRecord?.healthStatus).toBe('RED');

    const logs = monitor.getHealthLogs(deployment.id);
    expect(logs.length).toBe(3);
  });

  it('Given a deployment in RED health status, When health checks start succeeding, Then the status recovers to GREEN', async () => {
    // Given — push to RED with 3 failures
    const deployment = await orchestrator.create(baseConfig, 'user-1');
    await orchestrator.deploy(deployment.id, 'user-1');
    const record = await orchestrator.get(deployment.id);
    (record as any).status = 'ONLINE';
    (record as any).providerDeploymentId = 'test';
    adapter.healthResult = { healthy: false, status: 'RED' };

    await monitor.checkOne(record!);
    await monitor.checkOne(record!);
    const redResult = await monitor.checkOne(record!);
    expect(redResult.status).toBe('RED');

    // When — health check succeeds again
    adapter.healthResult = { healthy: true, status: 'GREEN', responseTimeMs: 30 };
    const recoveredResult = await monitor.checkOne(record!);

    // Then
    expect(recoveredResult.status).toBe('GREEN');
    expect(recoveredResult.healthy).toBe(true);

    const updatedRecord = await orchestrator.get(deployment.id);
    expect(updatedRecord?.healthStatus).toBe('GREEN');

    const logs = monitor.getHealthLogs(deployment.id);
    expect(logs.length).toBe(4);
    expect(logs.some((l) => l.status === 'GREEN')).toBe(true);
    expect(logs.some((l) => l.status === 'RED')).toBe(true);
  });
});
