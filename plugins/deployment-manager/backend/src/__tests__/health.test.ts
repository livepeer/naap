import { describe, it, expect, beforeEach } from 'vitest';
import { HealthMonitorService } from '../services/HealthMonitorService.js';
import { ProviderAdapterRegistry } from '../services/ProviderAdapterRegistry.js';
import { DeploymentOrchestrator } from '../services/DeploymentOrchestrator.js';
import { AuditService } from '../services/AuditService.js';
import type { IProviderAdapter } from '../adapters/IProviderAdapter.js';
import type { DeployConfig, ProviderDeployment, ProviderStatus, HealthResult, GpuOption, UpdateConfig } from '../types/index.js';

class HealthTestAdapter implements IProviderAdapter {
  readonly slug = 'health-test';
  readonly displayName = 'Health Test';
  readonly connectorSlug = 'health-test';
  readonly mode = 'serverless' as const;
  readonly icon = '🧪';
  readonly description = 'Test';
  readonly authMethod = 'api-key';

  healthResponse: HealthResult = { healthy: true, status: 'GREEN', responseTimeMs: 50 };

  async getGpuOptions(): Promise<GpuOption[]> { return []; }
  async deploy(): Promise<ProviderDeployment> {
    return { providerDeploymentId: 'test', status: 'DEPLOYING' };
  }
  async getStatus(): Promise<ProviderStatus> { return { status: 'ONLINE' }; }
  async destroy(): Promise<void> {}
  async update(_id: string, _config: UpdateConfig): Promise<ProviderDeployment> {
    return { providerDeploymentId: 'test', status: 'UPDATING' };
  }
  async healthCheck(): Promise<HealthResult> { return this.healthResponse; }
}

describe('HealthMonitorService', () => {
  let monitor: HealthMonitorService;
  let adapter: HealthTestAdapter;
  let orchestrator: DeploymentOrchestrator;

  beforeEach(async () => {
    const registry = new ProviderAdapterRegistry();
    adapter = new HealthTestAdapter();
    registry.register(adapter);
    const audit = new AuditService();
    orchestrator = new DeploymentOrchestrator(registry, audit);
    monitor = new HealthMonitorService(registry, orchestrator, {
      intervalMs: 1000,
      degradedThresholdMs: 100,
      failureThreshold: 3,
    });
  });

  it('should compute GREEN for healthy fast response', async () => {
    const d = await orchestrator.create({
      name: 'test', providerSlug: 'health-test', gpuModel: 'A100',
      gpuVramGb: 80, gpuCount: 1, artifactType: 'ai-runner',
      artifactVersion: 'v1', dockerImage: 'test:v1',
    }, 'user');
    (d as any).status = 'ONLINE';
    (d as any).providerDeploymentId = 'test';

    adapter.healthResponse = { healthy: true, status: 'GREEN', responseTimeMs: 50 };
    const result = await monitor.checkById(d.id);
    expect(result?.status).toBe('GREEN');
  });

  it('should compute ORANGE for slow response', async () => {
    const d = await orchestrator.create({
      name: 'test', providerSlug: 'health-test', gpuModel: 'A100',
      gpuVramGb: 80, gpuCount: 1, artifactType: 'ai-runner',
      artifactVersion: 'v1', dockerImage: 'test:v1',
    }, 'user');
    (d as any).status = 'ONLINE';
    (d as any).providerDeploymentId = 'test';

    adapter.healthResponse = { healthy: true, status: 'GREEN', responseTimeMs: 200 };
    const result = await monitor.checkById(d.id);
    expect(result?.status).toBe('ORANGE');
  });

  it('should compute RED after consecutive failures', async () => {
    const d = await orchestrator.create({
      name: 'test', providerSlug: 'health-test', gpuModel: 'A100',
      gpuVramGb: 80, gpuCount: 1, artifactType: 'ai-runner',
      artifactVersion: 'v1', dockerImage: 'test:v1',
    }, 'user');
    (d as any).status = 'ONLINE';
    (d as any).providerDeploymentId = 'test';

    adapter.healthResponse = { healthy: false, status: 'RED' };
    await monitor.checkById(d.id);
    await monitor.checkById(d.id);
    const result = await monitor.checkById(d.id);
    expect(result?.status).toBe('RED');
  });

  it('should store health logs', async () => {
    const d = await orchestrator.create({
      name: 'test', providerSlug: 'health-test', gpuModel: 'A100',
      gpuVramGb: 80, gpuCount: 1, artifactType: 'ai-runner',
      artifactVersion: 'v1', dockerImage: 'test:v1',
    }, 'user');
    (d as any).status = 'ONLINE';
    (d as any).providerDeploymentId = 'test';

    await monitor.checkById(d.id);
    await monitor.checkById(d.id);

    const logs = monitor.getHealthLogs(d.id);
    expect(logs).toHaveLength(2);
  });
});
