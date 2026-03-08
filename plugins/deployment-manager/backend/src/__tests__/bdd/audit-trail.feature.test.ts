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

describe('Feature: Audit Trail Integrity', () => {
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

  it('Given a full lifecycle (create, deploy, update, destroy), When the audit log is queried, Then it contains CREATE, DEPLOY, UPDATE, and DESTROY entries in order', async () => {
    // Given — run the full lifecycle
    const deployment = await orchestrator.create(baseConfig, 'user-1');
    await orchestrator.deploy(deployment.id, 'user-1');
    await orchestrator.syncStatus(deployment.id, 'user-1');
    await orchestrator.updateDeployment(
      deployment.id,
      { artifactVersion: 'v2.0.0', dockerImage: 'livepeer/ai-runner:v2.0.0' },
      'user-1',
    );
    await orchestrator.destroy(deployment.id, 'user-1');

    // When
    const auditLogs = await audit.query({ deploymentId: deployment.id });

    // Then
    expect(auditLogs.total).toBe(4);

    const actions = auditLogs.data.map((l) => l.action);
    expect(actions).toContain('CREATE');
    expect(actions).toContain('DEPLOY');
    expect(actions).toContain('UPDATE');
    expect(actions).toContain('DESTROY');

    auditLogs.data.forEach((log) => {
      expect(log.status).toBe('success');
      expect(log.userId).toBe('user-1');
      expect(log.resource).toBe('deployment');
      expect(log.resourceId).toBe(deployment.id);
      expect(log.id).toBeDefined();
      expect(log.createdAt).toBeInstanceOf(Date);
    });

    const createLog = auditLogs.data.find((l) => l.action === 'CREATE')!;
    expect(createLog.details).toMatchObject({ name: 'test', provider: 'mock', artifact: 'ai-runner' });

    const deployLog = auditLogs.data.find((l) => l.action === 'DEPLOY')!;
    expect(deployLog.details).toMatchObject({ providerDeploymentId: 'mock-123' });

    const updateLog = auditLogs.data.find((l) => l.action === 'UPDATE')!;
    expect(updateLog.details).toMatchObject({ artifactVersion: 'v2.0.0' });
  });

  it('Given a deploy that fails, When the audit log is queried, Then the failure is logged with error details', async () => {
    // Given
    adapter.shouldFail = true;
    const deployment = await orchestrator.create(baseConfig, 'user-1');

    // When
    await expect(orchestrator.deploy(deployment.id, 'user-1')).rejects.toThrow('Mock deploy failure');

    // Then
    const auditLogs = await audit.query({ deploymentId: deployment.id });
    expect(auditLogs.total).toBe(2);

    const failedLog = auditLogs.data.find((l) => l.action === 'DEPLOY')!;
    expect(failedLog).toBeDefined();
    expect(failedLog.status).toBe('failure');
    expect(failedLog.errorMsg).toBe('Mock deploy failure');
    expect(failedLog.userId).toBe('user-1');

    const createLog = auditLogs.data.find((l) => l.action === 'CREATE')!;
    expect(createLog.status).toBe('success');
  });

  it('Given multiple deployments by different users, When audit logs are queried with filters, Then only matching entries are returned', async () => {
    // Given
    const d1 = await orchestrator.create(baseConfig, 'alice');
    await orchestrator.deploy(d1.id, 'alice');
    await orchestrator.syncStatus(d1.id, 'alice');

    const d2 = await orchestrator.create({ ...baseConfig, name: 'test-2' }, 'bob');
    await orchestrator.deploy(d2.id, 'bob');
    await orchestrator.syncStatus(d2.id, 'bob');
    await orchestrator.destroy(d2.id, 'bob');

    // When — filter by user
    const aliceLogs = await audit.query({ userId: 'alice' });
    const bobLogs = await audit.query({ userId: 'bob' });

    // Then
    expect(aliceLogs.data.every((l) => l.userId === 'alice')).toBe(true);
    expect(aliceLogs.total).toBe(2);

    expect(bobLogs.data.every((l) => l.userId === 'bob')).toBe(true);
    expect(bobLogs.total).toBe(3);

    // When — filter by action
    const deployLogs = await audit.query({ action: 'DEPLOY' });
    expect(deployLogs.total).toBe(2);
    expect(deployLogs.data.every((l) => l.action === 'DEPLOY')).toBe(true);

    // When — filter by deploymentId
    const d1Logs = await audit.query({ deploymentId: d1.id });
    expect(d1Logs.total).toBe(2);
    expect(d1Logs.data.every((l) => l.deploymentId === d1.id)).toBe(true);

    // When — paginate
    const allLogs = await audit.query({});
    expect(allLogs.total).toBe(5);

    const page1 = await audit.query({ limit: 2, offset: 0 });
    expect(page1.data.length).toBe(2);
    expect(page1.total).toBe(5);

    const page2 = await audit.query({ limit: 2, offset: 2 });
    expect(page2.data.length).toBe(2);

    const page3 = await audit.query({ limit: 2, offset: 4 });
    expect(page3.data.length).toBe(1);
  });
});
