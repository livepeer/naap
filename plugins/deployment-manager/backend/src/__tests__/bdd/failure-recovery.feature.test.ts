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

describe('Feature: Deployment Failure and Recovery', () => {
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

  it('Given a deployment that failed, When the operator retries after fixing the issue, Then the deployment succeeds', async () => {
    // Given — first deploy fails
    adapter.shouldFail = true;
    const deployment = await orchestrator.create(baseConfig, 'user-1');
    await expect(orchestrator.deploy(deployment.id, 'user-1')).rejects.toThrow('Mock deploy failure');
    const failedRecord = await orchestrator.get(deployment.id);
    expect(failedRecord?.status).toBe('FAILED');
    expect(adapter.deployCallCount).toBe(1);

    // When — fix the issue and retry
    adapter.shouldFail = false;
    const retried = await orchestrator.retry(deployment.id, 'user-1');

    // Then
    expect(retried.status).toBe('ONLINE');
    expect(retried.healthStatus).toBe('GREEN');
    expect(adapter.deployCallCount).toBe(2);

    const history = await orchestrator.getStatusHistory(deployment.id);
    const statuses = history.map((h) => h.toStatus);
    expect(statuses).toHaveLength(6);
    expect(statuses).toContain('PENDING');
    expect(statuses).toContain('FAILED');
    expect(statuses).toContain('VALIDATING');
    expect(statuses).toContain('ONLINE');
    expect(statuses.filter((s) => s === 'DEPLOYING')).toHaveLength(2);
  });

  it('Given a deployment that is not in FAILED state, When the operator attempts retry, Then the retry is rejected', async () => {
    // Given — deploy succeeds, deployment is ONLINE
    const deployment = await orchestrator.create(baseConfig, 'user-1');
    await orchestrator.deploy(deployment.id, 'user-1');
    const record = await orchestrator.get(deployment.id);
    expect(record?.status).toBe('ONLINE');

    // When / Then
    await expect(orchestrator.retry(deployment.id, 'user-1')).rejects.toThrow(
      'Can only retry FAILED deployments, current status: ONLINE',
    );

    // Also verify PENDING state cannot be retried
    const pendingDeployment = await orchestrator.create(baseConfig, 'user-2');
    expect(pendingDeployment.status).toBe('PENDING');
    await expect(orchestrator.retry(pendingDeployment.id, 'user-2')).rejects.toThrow(
      'Can only retry FAILED deployments, current status: PENDING',
    );
  });
});
