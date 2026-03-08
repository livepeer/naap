import { describe, it, expect, beforeEach } from 'vitest';
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

describe('Feature: Full Deployment Lifecycle', () => {
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
  });

  it('Given a valid deploy config, When the operator deploys, Then the deployment transitions PENDING -> DEPLOYING -> ONLINE', async () => {
    // Given
    const deployment = await orchestrator.create(baseConfig, 'user-1');
    expect(deployment.status).toBe('PENDING');

    // When — deploy returns DEPLOYING for serverless adapters
    await orchestrator.deploy(deployment.id, 'user-1');
    // syncStatus advances serverless DEPLOYING -> ONLINE
    const result = await orchestrator.syncStatus(deployment.id, 'user-1');

    // Then
    expect(result.status).toBe('ONLINE');
    expect(result.healthStatus).toBe('GREEN');
    expect(result.providerDeploymentId).toBe('mock-123');
    expect(result.endpointUrl).toBe('https://mock/endpoint');
    expect(result.deployedAt).toBeInstanceOf(Date);
    expect(adapter.deployCallCount).toBe(1);

    const history = await orchestrator.getStatusHistory(deployment.id);
    const statuses = history.map((h) => h.toStatus);
    expect(statuses).toContain('PENDING');
    expect(statuses).toContain('DEPLOYING');
    expect(statuses).toContain('ONLINE');
  });

  it('Given a serverless adapter with unhealthy health check but ONLINE status, deployment reaches ONLINE with ORANGE health', async () => {
    // Serverless endpoints with workersMin=0 may be unhealthy (no workers) but still correctly deployed
    adapter.healthResult = { healthy: false, status: 'RED', responseTimeMs: 100 };
    const deployment = await orchestrator.create(baseConfig, 'user-1');

    await orchestrator.deploy(deployment.id, 'user-1');
    // Use validate() which runs the health check; syncStatus would skip it
    const result = await orchestrator.validate(deployment.id, 'user-1');

    expect(result.status).toBe('ONLINE');
    expect(result.healthStatus).toBe('ORANGE');
  });

  it('Given a non-serverless adapter with unhealthy health check, deployment reaches FAILED status', async () => {
    // Non-serverless providers should still fail when health check reports unhealthy
    class DedicatedMockAdapter extends MockAdapter {
      override readonly slug = 'mock-dedicated' as any;
      override readonly mode = 'dedicated' as any;
    }
    const dedicatedAdapter = new DedicatedMockAdapter();
    dedicatedAdapter.healthResult = { healthy: false, status: 'RED', responseTimeMs: 100 };

    const dedicatedRegistry = new ProviderAdapterRegistry();
    dedicatedRegistry.register(dedicatedAdapter);
    const dedicatedOrchestrator = new DeploymentOrchestrator(dedicatedRegistry, audit, new InMemoryDeploymentStore());

    const config = { ...baseConfig, providerSlug: 'mock-dedicated' };
    const deployment = await dedicatedOrchestrator.create(config, 'user-1');
    await dedicatedOrchestrator.deploy(deployment.id, 'user-1');
    // Use validate() which runs the health check and fails non-serverless unhealthy deployments
    const result = await dedicatedOrchestrator.validate(deployment.id, 'user-1');

    expect(result.status).toBe('FAILED');
    expect(result.healthStatus).toBe('RED');
  });
});
