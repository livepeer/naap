import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DeploymentOrchestrator } from '../../services/DeploymentOrchestrator.js';
import { ProviderAdapterRegistry } from '../../services/ProviderAdapterRegistry.js';
import { AuditService } from '../../services/AuditService.js';
import { InMemoryDeploymentStore } from '../../store/InMemoryDeploymentStore.js';
import { TemplateRegistry } from '../../services/TemplateRegistry.js';
import { LivepeerComposeBuilder } from '../../services/LivepeerComposeBuilder.js';
import type { IProviderAdapter } from '../../adapters/IProviderAdapter.js';
import type { DeployConfig, HealthResult } from '../../types/index.js';

// Mock SshComposeAdapter for BDD tests
class MockSshComposeAdapter implements IProviderAdapter {
  readonly slug = 'ssh-compose';
  readonly displayName = 'Mock SSH Compose';
  readonly mode = 'ssh-bridge' as const;
  readonly icon = '🐳';
  readonly description = 'Mock';
  readonly authMethod = 'ssh-key';
  readonly apiConfig = { upstreamBaseUrl: 'http://mock', authType: 'none' as const, secretNames: ['ssh-key'], healthCheckPath: null };
  healthResult: HealthResult = { healthy: true, status: 'GREEN', responseTimeMs: 50 };

  async getGpuOptions() {
    return [
      { id: 'CPU', name: 'CPU Only', vramGb: 0, available: true },
      { id: 'NVIDIA A100 80GB', name: 'A100', vramGb: 80, available: true },
    ];
  }

  async deploy(config: DeployConfig) {
    const project = (config.artifactConfig as any)?.composeProject || 'test-project';
    return {
      providerDeploymentId: `compose:${config.sshHost}:${project}:job-1:${config.healthPort}:${config.healthEndpoint}`,
      endpointUrl: `http://${config.sshHost}:${config.healthPort}`,
      status: 'DEPLOYING' as const,
    };
  }

  async getStatus() { return { status: 'ONLINE' as const }; }
  async destroy() {}
  async update() { return { providerDeploymentId: 'compose:host:proj:job-2:9090:/health', status: 'UPDATING' as const }; }
  async healthCheck() { return this.healthResult; }
}

describe('Feature: Livepeer Inference Template', () => {
  let orchestrator: DeploymentOrchestrator;
  let registry: ProviderAdapterRegistry;
  let templateRegistry: TemplateRegistry;
  let composeBuilder: LivepeerComposeBuilder;
  let adapter: MockSshComposeAdapter;

  beforeEach(() => {
    registry = new ProviderAdapterRegistry();
    adapter = new MockSshComposeAdapter();
    registry.register(adapter);
    templateRegistry = new TemplateRegistry();
    composeBuilder = new LivepeerComposeBuilder();
    orchestrator = new DeploymentOrchestrator(registry, new AuditService(), new InMemoryDeploymentStore());
  });

  describe('Scenario: Template appears in template list', () => {
    it('Given the deployment manager is running, When the user fetches templates, Then "livepeer-inference" appears with category "curated"', () => {
      const templates = templateRegistry.getTemplates();
      const livepeerTemplate = templates.find(t => t.id === 'livepeer-inference');

      expect(livepeerTemplate).toBeDefined();
      expect(livepeerTemplate!.name).toBe('Livepeer Inference Adapter');
      expect(livepeerTemplate!.category).toBe('curated');
      expect(livepeerTemplate!.healthPort).toBe(9090);
      expect(livepeerTemplate!.healthEndpoint).toBe('/health');
    });
  });

  describe('Scenario: Compose builder generates valid Topology 3 YAML', () => {
    it('Given a config with topology split-cpu-serverless and fal.ai provider, Then the YAML contains correct services with auto-wired URLs', () => {
      const result = composeBuilder.build({
        topology: 'split-cpu-serverless',
        serverlessProvider: 'fal-ai',
        serverlessModelId: 'fal-ai/flux/dev',
        serverlessApiKey: 'test-key',
        capacity: 4,
        publicAddress: '203.0.113.1:7935',
      });

      // Services present
      expect(result.yaml).toContain('go-livepeer');
      expect(result.yaml).toContain('inference-adapter');
      expect(result.yaml).toContain('serverless-proxy');

      // Auto-wired URLs
      expect(result.yaml).toContain('http://go-livepeer:7935');
      expect(result.yaml).toContain('http://serverless-proxy:8080');

      // Shared secret
      expect(result.orchestratorSecret).toBeTruthy();
      const secretCount = (result.yaml.match(new RegExp(result.orchestratorSecret, 'g')) || []).length;
      expect(secretCount).toBeGreaterThanOrEqual(2);

      // Provider env vars
      expect(result.yaml).toContain('FAL_KEY');
      expect(result.yaml).toContain('fal-ai/flux/dev');

      // Derived capability name
      expect(result.capabilityName).toBe('flux-dev');
    });
  });

  describe('Scenario: Compose builder generates valid Topology 1 YAML', () => {
    it('Given a config with topology all-in-one and a model image, Then the YAML contains model service with GPU runtime', () => {
      const result = composeBuilder.build({
        topology: 'all-in-one',
        modelImage: 'ghcr.io/huggingface/text-generation-inference:latest',
        serverlessModelId: 'meta-llama/Llama-3.1-70B-Instruct',
      });

      expect(result.yaml).toContain('model');
      expect(result.yaml).toContain('http://model:8080');
      expect(result.yaml).toContain('nvidia');
      expect(result.yaml).toContain('ghcr.io/huggingface/text-generation-inference');
      expect(result.yaml).not.toContain('serverless-proxy');
    });
  });

  describe('Scenario: Auto-config derives capability name from model', () => {
    it.each([
      ['fal-ai/flux/dev', 'flux-dev'],
      ['meta-llama/Llama-3.1-70B-Instruct', 'meta-llama-llama-3-1-70b-instruct'],
      ['whisper-v3', 'whisper-v3'],
    ])('Given model %s, Then capability name is %s', (modelId, expected) => {
      const name = composeBuilder.deriveCapabilityName({
        topology: 'split-cpu-serverless',
        serverlessModelId: modelId,
      });
      expect(name).toBe(expected);
    });
  });

  describe('Scenario: Full deployment lifecycle with ssh-compose', () => {
    it('Given a valid livepeer config, When deployed via ssh-compose, Then deployment reaches ONLINE', { timeout: 30_000 }, async () => {
      // Build compose
      const composeResult = composeBuilder.build({
        topology: 'split-cpu-serverless',
        serverlessProvider: 'fal-ai',
        serverlessModelId: 'fal-ai/flux/dev',
        serverlessApiKey: 'test-key',
      });

      // Create deployment
      const config: DeployConfig = {
        name: 'test-livepeer-deploy',
        providerSlug: 'ssh-compose',
        gpuModel: 'CPU',
        gpuVramGb: 0,
        gpuCount: 0,
        artifactType: 'livepeer-inference',
        artifactVersion: 'latest',
        dockerImage: 'livepeer/inference-adapter:latest',
        sshHost: '10.0.0.1',
        sshUsername: 'deploy',
        healthPort: 9090,
        healthEndpoint: '/health',
        templateId: 'livepeer-inference',
        artifactConfig: {
          composeYaml: composeResult.yaml,
          composeProject: composeResult.project,
          topology: 'split-cpu-serverless',
          capabilityName: composeResult.capabilityName,
          orchestratorSecret: composeResult.orchestratorSecret,
        },
      };

      const deployment = await orchestrator.create(config, 'user-1');
      expect(deployment.status).toBe('PENDING');
      expect(deployment.templateId).toBe('livepeer-inference');

      // Deploy
      const result = await orchestrator.deploy(deployment.id, 'user-1');
      expect(result.status).toBe('ONLINE');
      expect(result.healthStatus).toBe('GREEN');
      expect(result.providerDeploymentId).toContain('compose:');

      // Verify artifact config preserved
      expect(result.artifactConfig).toBeDefined();
      expect((result.artifactConfig as any).capabilityName).toBe('flux-dev');
      expect((result.artifactConfig as any).topology).toBe('split-cpu-serverless');
    });
  });

  describe('Scenario: YAML values are sanitized', () => {
    it('Given a model ID with YAML special characters, Then the YAML is valid', () => {
      const result = composeBuilder.build({
        topology: 'split-cpu-serverless',
        serverlessProvider: 'custom',
        serverlessEndpointUrl: 'http://example.com:8080/api?key=value&foo=bar',
        capabilityName: 'test',
      });

      // URL with special chars should be properly quoted
      expect(result.yaml).toContain("'http://example.com:8080/api?key=value&foo=bar'");
      // Should not crash or produce broken YAML
      expect(result.yaml).toBeTruthy();
    });
  });
});
