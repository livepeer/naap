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
  destroyCalled = false;

  async getGpuOptions() { return [{ id: 'gpu', name: 'GPU', vramGb: 80, available: true }]; }
  async deploy(config: DeployConfig) {
    this.deployCallCount++;
    if (this.shouldFail) throw new Error('Mock deploy failure');
    return { providerDeploymentId: 'mock-123', endpointUrl: 'https://mock/endpoint', status: 'DEPLOYING' as const };
  }
  async getStatus() { return { status: 'ONLINE' as const }; }
  async destroy() { this.destroyCalled = true; }
  async update(_id: string, _config: UpdateConfig) { return { providerDeploymentId: 'mock-123', status: 'UPDATING' as const }; }
  async healthCheck() { return this.healthResult; }
}

const baseConfig: DeployConfig = {
  name: 'test', providerSlug: 'mock', gpuModel: 'A100', gpuVramGb: 80, gpuCount: 1,
  artifactType: 'ai-runner', artifactVersion: 'v1.0.0', dockerImage: 'livepeer/ai-runner:v1.0.0',
};

describe('Feature: Deployment Destruction', () => {
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

  it('Given an ONLINE deployment, When the operator destroys it, Then the deployment reaches DESTROYED with a DESTROY audit log entry', async () => {
    // Given
    const deployment = await orchestrator.create(baseConfig, 'user-1');
    await orchestrator.deploy(deployment.id, 'user-1');
    await orchestrator.syncStatus(deployment.id, 'user-1');
    const online = await orchestrator.get(deployment.id);
    expect(online?.status).toBe('ONLINE');

    // When
    const destroyed = await orchestrator.destroy(deployment.id, 'user-1');

    // Then
    expect(destroyed.record.status).toBe('DESTROYED');
    expect(adapter.destroyCalled).toBe(true);

    const history = await orchestrator.getStatusHistory(deployment.id);
    const statuses = history.map((h) => h.toStatus).reverse();
    expect(statuses).toContain('DESTROYED');

    const auditLogs = await audit.query({ deploymentId: deployment.id, action: 'DESTROY' });
    expect(auditLogs.total).toBe(1);
    expect(auditLogs.data[0].status).toBe('success');
    expect(auditLogs.data[0].userId).toBe('user-1');
    expect(auditLogs.data[0].resource).toBe('deployment');
  });

  it('Given a DESTROYED deployment, When the operator tries to destroy it again, Then the operation is rejected with an invalid transition error', async () => {
    // Given
    const deployment = await orchestrator.create(baseConfig, 'user-1');
    await orchestrator.deploy(deployment.id, 'user-1');
    await orchestrator.syncStatus(deployment.id, 'user-1');
    await orchestrator.destroy(deployment.id, 'user-1');
    const destroyed = await orchestrator.get(deployment.id);
    expect(destroyed?.status).toBe('DESTROYED');

    // When / Then
    await expect(orchestrator.destroy(deployment.id, 'user-1')).rejects.toThrow(
      'Invalid state transition: DESTROYED -> DESTROYED',
    );
  });
});
