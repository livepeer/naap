import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DeploymentOrchestrator } from '../../services/DeploymentOrchestrator.js';
import { AuditService } from '../../services/AuditService.js';
import { ProviderAdapterRegistry } from '../../services/ProviderAdapterRegistry.js';
import { InMemoryDeploymentStore } from '../../store/InMemoryDeploymentStore.js';
import type { IProviderAdapter } from '../../adapters/IProviderAdapter.js';
import type { DeployConfig } from '../../types/index.js';

function makeMockAdapter(slug: string): IProviderAdapter & { deploy: ReturnType<typeof vi.fn> } {
  return {
    slug,
    displayName: slug,
    mode: 'serverless' as const,
    icon: 'T',
    description: '',
    authMethod: 'api-key',
    apiConfig: { upstreamBaseUrl: 'http://mock', authType: 'bearer' as const, secretNames: ['api-key'], healthCheckPath: null },
    getGpuOptions: vi.fn().mockResolvedValue([]),
    deploy: vi.fn().mockResolvedValue({
      providerDeploymentId: 'pid-1',
      endpointUrl: 'http://test.endpoint',
      status: 'DEPLOYING',
    }),
    getStatus: vi.fn().mockResolvedValue({ status: 'ONLINE' }),
    destroy: vi.fn().mockResolvedValue(undefined),
    update: vi.fn().mockResolvedValue({ providerDeploymentId: 'pid-1', status: 'UPDATING' }),
    healthCheck: vi.fn().mockResolvedValue({ healthy: true, status: 'GREEN' }),
  };
}

describe('Feature: Environment Variables and Concurrency', () => {
  let orchestrator: DeploymentOrchestrator;
  let registry: ProviderAdapterRegistry;
  let mockAdapter: ReturnType<typeof makeMockAdapter>;

  beforeEach(() => {
    registry = new ProviderAdapterRegistry();
    mockAdapter = makeMockAdapter('fal-ai');
    registry.register(mockAdapter);
    orchestrator = new DeploymentOrchestrator(registry, new AuditService(), new InMemoryDeploymentStore());
  });

  it('Scenario: Deploy with environment variables — envVars are passed to the adapter', async () => {
    const config: DeployConfig = {
      name: 'env-test',
      providerSlug: 'fal-ai',
      gpuModel: 'A100',
      gpuVramGb: 80,
      gpuCount: 1,
      artifactType: 'ai-runner',
      artifactVersion: 'v1.0',
      dockerImage: 'test/image:v1.0',
      envVars: { MODEL_ID: 'stable-diffusion-v1-5', BATCH_SIZE: '4' },
      concurrency: 3,
    };

    const record = await orchestrator.create(config, 'user-1');
    expect(record.envVars).toEqual({ MODEL_ID: 'stable-diffusion-v1-5', BATCH_SIZE: '4' });
    expect(record.concurrency).toBe(3);

    await orchestrator.deploy(record.id, 'user-1');

    expect(mockAdapter.deploy).toHaveBeenCalled();
    const deployCall = mockAdapter.deploy.mock.calls[0][0] as DeployConfig;
    expect(deployCall.envVars).toEqual({ MODEL_ID: 'stable-diffusion-v1-5', BATCH_SIZE: '4' });
    expect(deployCall.concurrency).toBe(3);
  });

  it('Scenario: Deploy without environment variables — defaults are used', async () => {
    const config: DeployConfig = {
      name: 'no-env-test',
      providerSlug: 'fal-ai',
      gpuModel: 'A100',
      gpuVramGb: 80,
      gpuCount: 1,
      artifactType: 'ai-runner',
      artifactVersion: 'v1.0',
      dockerImage: 'test/image:v1.0',
    };

    const record = await orchestrator.create(config, 'user-1');
    expect(record.envVars).toBeUndefined();
    expect(record.concurrency).toBeUndefined();

    await orchestrator.deploy(record.id, 'user-1');

    const deployCall = mockAdapter.deploy.mock.calls[0][0] as DeployConfig;
    expect(deployCall.envVars).toBeUndefined();
    expect(deployCall.concurrency).toBeUndefined();
  });

  it('Scenario: Deploy with cost estimate — estimatedCostPerHour is stored', async () => {
    const config: DeployConfig = {
      name: 'cost-test',
      providerSlug: 'fal-ai',
      gpuModel: 'A100',
      gpuVramGb: 80,
      gpuCount: 1,
      artifactType: 'ai-runner',
      artifactVersion: 'v1.0',
      dockerImage: 'test/image:v1.0',
      estimatedCostPerHour: 2.55,
    };

    const record = await orchestrator.create(config, 'user-1');
    expect(record.estimatedCostPerHour).toBe(2.55);

    const retrieved = await orchestrator.get(record.id);
    expect(retrieved!.estimatedCostPerHour).toBe(2.55);
  });

  it('Scenario: EnvVars and concurrency persist through the deploy lifecycle', async () => {
    const config: DeployConfig = {
      name: 'lifecycle-env',
      providerSlug: 'fal-ai',
      gpuModel: 'A100',
      gpuVramGb: 80,
      gpuCount: 1,
      artifactType: 'ai-runner',
      artifactVersion: 'v1.0',
      dockerImage: 'test/image:v1.0',
      envVars: { KEY: 'value' },
      concurrency: 10,
    };

    const record = await orchestrator.create(config, 'user-1');
    const deployed = await orchestrator.deploy(record.id, 'user-1');

    expect(deployed.status).toBe('ONLINE');
    expect(deployed.envVars).toEqual({ KEY: 'value' });
    expect(deployed.concurrency).toBe(10);
  });
});
