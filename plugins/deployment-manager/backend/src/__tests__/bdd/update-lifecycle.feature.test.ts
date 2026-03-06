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

describe('Feature: Deployment Update', () => {
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

  it('Given an ONLINE deployment, When the operator updates the artifact version, Then the deployment transitions UPDATING -> VALIDATING -> ONLINE with updated fields', async () => {
    // Given
    const deployment = await orchestrator.create(baseConfig, 'user-1');
    await orchestrator.deploy(deployment.id, 'user-1');
    const online = await orchestrator.get(deployment.id);
    expect(online?.status).toBe('ONLINE');
    expect(online?.artifactVersion).toBe('v1.0.0');

    // When
    const updateConfig: UpdateConfig = {
      artifactVersion: 'v2.0.0',
      dockerImage: 'livepeer/ai-runner:v2.0.0',
    };
    const updated = await orchestrator.updateDeployment(deployment.id, updateConfig, 'user-1');

    // Then
    expect(updated.status).toBe('ONLINE');
    expect(updated.artifactVersion).toBe('v2.0.0');
    expect(updated.dockerImage).toBe('livepeer/ai-runner:v2.0.0');
    expect(updated.healthStatus).toBe('GREEN');

    const history = await orchestrator.getStatusHistory(deployment.id);
    const statuses = history.map((h) => h.toStatus);
    expect(statuses).toHaveLength(7);
    expect(statuses).toContain('PENDING');
    expect(statuses).toContain('DEPLOYING');
    expect(statuses).toContain('UPDATING');
    expect(statuses.filter((s) => s === 'VALIDATING')).toHaveLength(2);
    expect(statuses.filter((s) => s === 'ONLINE')).toHaveLength(2);

    const auditLogs = await audit.query({ deploymentId: deployment.id, action: 'UPDATE' });
    expect(auditLogs.total).toBe(1);
    expect(auditLogs.data[0].status).toBe('success');
    expect(auditLogs.data[0].details).toMatchObject({
      artifactVersion: 'v2.0.0',
      dockerImage: 'livepeer/ai-runner:v2.0.0',
    });
  });

  it('Given a PENDING deployment, When the operator attempts an update, Then the update is rejected with an invalid state transition error', async () => {
    // Given
    const deployment = await orchestrator.create(baseConfig, 'user-1');
    expect(deployment.status).toBe('PENDING');

    // When / Then
    const updateConfig: UpdateConfig = { artifactVersion: 'v2.0.0' };
    await expect(
      orchestrator.updateDeployment(deployment.id, updateConfig, 'user-1'),
    ).rejects.toThrow('Invalid state transition: PENDING -> UPDATING');

    // Verify status hasn't changed
    const record = await orchestrator.get(deployment.id);
    expect(record?.status).toBe('PENDING');
  });
});
