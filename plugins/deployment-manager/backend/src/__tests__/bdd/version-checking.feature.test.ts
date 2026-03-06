import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { VersionCheckerService } from '../../services/VersionCheckerService.js';
import { DeploymentOrchestrator } from '../../services/DeploymentOrchestrator.js';
import { ProviderAdapterRegistry } from '../../services/ProviderAdapterRegistry.js';
import { AuditService } from '../../services/AuditService.js';
import { InMemoryDeploymentStore } from '../../store/InMemoryDeploymentStore.js';
import { TemplateRegistry } from '../../services/TemplateRegistry.js';
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

describe('Feature: Version Checking', () => {
  let versionChecker: VersionCheckerService;
  let orchestrator: DeploymentOrchestrator;
  let registry: ProviderAdapterRegistry;
  let audit: AuditService;
  let adapter: MockAdapter;
  let templateRegistry: TemplateRegistry;

  beforeEach(() => {
    registry = new ProviderAdapterRegistry();
    adapter = new MockAdapter();
    registry.register(adapter);
    audit = new AuditService();
    orchestrator = new DeploymentOrchestrator(registry, audit, new InMemoryDeploymentStore());
    templateRegistry = new TemplateRegistry();
    versionChecker = new VersionCheckerService(orchestrator, templateRegistry);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('Given an ONLINE deployment on v1.0.0, When a newer version v2.0.0 is available, Then hasUpdate is true and latestVersion is reported', async () => {
    // Given
    const deployment = await orchestrator.create(baseConfig, 'user-1');
    await orchestrator.deploy(deployment.id, 'user-1');
    const record = await orchestrator.get(deployment.id);
    expect(record?.status).toBe('ONLINE');
    expect(record?.artifactVersion).toBe('v1.0.0');

    vi.spyOn(templateRegistry, 'getLatestVersion').mockResolvedValue({
      version: 'v2.0.0',
      publishedAt: '2026-01-01T00:00:00Z',
      prerelease: false,
      releaseUrl: 'https://github.com/livepeer/ai-runner/releases/tag/v2.0.0',
      dockerImage: 'livepeer/ai-runner:v2.0.0',
    });

    // When
    const result = await versionChecker.checkOne(deployment.id);

    // Then
    expect(result.hasUpdate).toBe(true);
    expect(result.currentVersion).toBe('v1.0.0');
    expect(result.latestVersion).toBe('v2.0.0');

    const updatedRecord = await orchestrator.get(deployment.id);
    expect(updatedRecord?.hasUpdate).toBe(true);
    expect(updatedRecord?.latestAvailableVersion).toBe('v2.0.0');
  });

  it('Given an ONLINE deployment already on the latest version, When version check runs, Then hasUpdate is false', async () => {
    // Given
    const deployment = await orchestrator.create(baseConfig, 'user-1');
    await orchestrator.deploy(deployment.id, 'user-1');
    const record = await orchestrator.get(deployment.id);
    expect(record?.status).toBe('ONLINE');

    vi.spyOn(templateRegistry, 'getLatestVersion').mockResolvedValue({
      version: 'v1.0.0',
      publishedAt: '2025-06-01T00:00:00Z',
      prerelease: false,
      releaseUrl: 'https://github.com/livepeer/ai-runner/releases/tag/v1.0.0',
      dockerImage: 'livepeer/ai-runner:v1.0.0',
    });

    // When
    const result = await versionChecker.checkOne(deployment.id);

    // Then
    expect(result.hasUpdate).toBe(false);
    expect(result.currentVersion).toBe('v1.0.0');
    expect(result.latestVersion).toBe('v1.0.0');

    const updatedRecord = await orchestrator.get(deployment.id);
    expect(updatedRecord?.hasUpdate).toBe(false);
  });

  it('Given non-ONLINE deployments, When checkAll runs, Then only ONLINE deployments are checked', async () => {
    // Given — one ONLINE and one PENDING deployment
    const onlineDeploy = await orchestrator.create(baseConfig, 'user-1');
    await orchestrator.deploy(onlineDeploy.id, 'user-1');
    const pendingDeploy = await orchestrator.create({ ...baseConfig, name: 'pending-test' }, 'user-2');
    expect((await orchestrator.get(pendingDeploy.id))?.status).toBe('PENDING');

    const getLatestSpy = vi.spyOn(templateRegistry, 'getLatestVersion').mockResolvedValue({
      version: 'v3.0.0',
      publishedAt: '2026-03-01T00:00:00Z',
      prerelease: false,
      releaseUrl: 'https://github.com/livepeer/ai-runner/releases/tag/v3.0.0',
      dockerImage: 'livepeer/ai-runner:v3.0.0',
    });

    // When
    await versionChecker.checkAll();

    // Then — getLatestVersion should only be called for the ONLINE deployment's artifact type
    expect(getLatestSpy).toHaveBeenCalledTimes(1);

    const onlineRecord = await orchestrator.get(onlineDeploy.id);
    expect(onlineRecord?.hasUpdate).toBe(true);
    expect(onlineRecord?.latestAvailableVersion).toBe('v3.0.0');

    const pendingRecord = await orchestrator.get(pendingDeploy.id);
    expect(pendingRecord?.hasUpdate).toBe(false);
    expect(pendingRecord?.latestAvailableVersion).toBeUndefined();
  });
});
