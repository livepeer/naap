import { describe, it, expect, beforeEach } from 'vitest';
import { DeploymentOrchestrator } from '../services/DeploymentOrchestrator.js';
import { ProviderAdapterRegistry } from '../services/ProviderAdapterRegistry.js';
import { AuditService } from '../services/AuditService.js';
import type { IProviderAdapter } from '../adapters/IProviderAdapter.js';
import type { DeployConfig, ProviderDeployment, ProviderStatus, HealthResult, GpuOption, UpdateConfig } from '../types/index.js';

class MockAdapter implements IProviderAdapter {
  readonly slug = 'mock';
  readonly displayName = 'Mock Provider';
  readonly connectorSlug = 'mock-connector';
  readonly mode = 'serverless' as const;
  readonly icon = '🧪';
  readonly description = 'Mock provider for testing';
  readonly authMethod = 'api-key';
  deployCallCount = 0;
  shouldFail = false;

  async getGpuOptions(): Promise<GpuOption[]> {
    return [{ id: 'test-gpu', name: 'Test GPU', vramGb: 24, available: true }];
  }

  async deploy(_config: DeployConfig): Promise<ProviderDeployment> {
    this.deployCallCount++;
    if (this.shouldFail) throw new Error('Mock deploy failure');
    return {
      providerDeploymentId: 'mock-deploy-123',
      endpointUrl: 'https://mock.provider/endpoint',
      status: 'DEPLOYING',
    };
  }

  async getStatus(_id: string): Promise<ProviderStatus> {
    return { status: 'ONLINE', endpointUrl: 'https://mock.provider/endpoint' };
  }

  async destroy(_id: string): Promise<void> {}

  async update(_id: string, _config: UpdateConfig): Promise<ProviderDeployment> {
    return {
      providerDeploymentId: 'mock-deploy-123',
      endpointUrl: 'https://mock.provider/endpoint',
      status: 'UPDATING',
    };
  }

  async healthCheck(): Promise<HealthResult> {
    return { healthy: true, status: 'GREEN', responseTimeMs: 50, statusCode: 200 };
  }
}

describe('DeploymentOrchestrator', () => {
  let orchestrator: DeploymentOrchestrator;
  let registry: ProviderAdapterRegistry;
  let audit: AuditService;
  let mockAdapter: MockAdapter;

  const baseConfig: DeployConfig = {
    name: 'test-deployment',
    providerSlug: 'mock',
    gpuModel: 'test-gpu',
    gpuVramGb: 24,
    gpuCount: 1,
    artifactType: 'ai-runner',
    artifactVersion: 'v0.14.1',
    dockerImage: 'livepeer/ai-runner:v0.14.1',
  };

  beforeEach(() => {
    registry = new ProviderAdapterRegistry();
    mockAdapter = new MockAdapter();
    registry.register(mockAdapter);
    audit = new AuditService();
    orchestrator = new DeploymentOrchestrator(registry, audit);
  });

  it('should create a deployment in PENDING state', async () => {
    const deployment = await orchestrator.create(baseConfig, 'user-1');
    expect(deployment.status).toBe('PENDING');
    expect(deployment.name).toBe('test-deployment');
    expect(deployment.providerSlug).toBe('mock');
    expect(deployment.artifactType).toBe('ai-runner');
  });

  it('should list deployments', async () => {
    await orchestrator.create(baseConfig, 'user-1');
    await orchestrator.create({ ...baseConfig, name: 'test-2' }, 'user-1');
    const list = await orchestrator.list();
    expect(list).toHaveLength(2);
  });

  it('should filter deployments by owner', async () => {
    await orchestrator.create(baseConfig, 'user-1');
    await orchestrator.create({ ...baseConfig, name: 'test-2' }, 'user-2');
    const list = await orchestrator.list({ ownerUserId: 'user-1' });
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe('test-deployment');
  });

  it('should transition from PENDING to DEPLOYING on deploy', async () => {
    const deployment = await orchestrator.create(baseConfig, 'user-1');
    const deployed = await orchestrator.deploy(deployment.id, 'user-1');
    expect(deployed.status).toBe('DEPLOYING');
    expect(deployed.providerDeploymentId).toBe('mock-deploy-123');
    expect(deployed.endpointUrl).toBe('https://mock.provider/endpoint');
  });

  it('should transition to FAILED when deploy throws', async () => {
    mockAdapter.shouldFail = true;
    const deployment = await orchestrator.create(baseConfig, 'user-1');
    await expect(orchestrator.deploy(deployment.id, 'user-1')).rejects.toThrow('Mock deploy failure');
    const failed = await orchestrator.get(deployment.id);
    expect(failed?.status).toBe('FAILED');
  });

  it('should reject invalid state transitions', async () => {
    const deployment = await orchestrator.create(baseConfig, 'user-1');
    await orchestrator.deploy(deployment.id, 'user-1');
    // DEPLOYING -> DESTROYING is not valid
    await expect(orchestrator.destroy(deployment.id, 'user-1')).rejects.toThrow('Invalid state transition');
  });

  it('should destroy a deployed deployment', async () => {
    const deployment = await orchestrator.create(baseConfig, 'user-1');
    await orchestrator.deploy(deployment.id, 'user-1');
    // Manually set to ONLINE for destroy
    const record = await orchestrator.get(deployment.id);
    (record as any).status = 'ONLINE';
    const destroyed = await orchestrator.destroy(deployment.id, 'user-1');
    expect(destroyed.status).toBe('DESTROYED');
  });

  it('should record status history', async () => {
    const deployment = await orchestrator.create(baseConfig, 'user-1');
    await orchestrator.deploy(deployment.id, 'user-1');
    const history = orchestrator.getStatusHistory(deployment.id);
    expect(history.length).toBeGreaterThanOrEqual(3); // PENDING, PROVISIONING, DEPLOYING
  });

  it('should create audit logs', async () => {
    await orchestrator.create(baseConfig, 'user-1');
    const logs = await audit.query({});
    expect(logs.data.length).toBeGreaterThanOrEqual(1);
    expect(logs.data[0].action).toBe('CREATE');
  });

  it('should update health status', async () => {
    const deployment = await orchestrator.create(baseConfig, 'user-1');
    await orchestrator.deploy(deployment.id, 'user-1');
    const record = await orchestrator.get(deployment.id);
    (record as any).status = 'ONLINE';
    orchestrator.updateHealthStatus(deployment.id, 'RED');
    const updated = await orchestrator.get(deployment.id);
    expect(updated?.status).toBe('OFFLINE');
    expect(updated?.healthStatus).toBe('RED');
  });
});
