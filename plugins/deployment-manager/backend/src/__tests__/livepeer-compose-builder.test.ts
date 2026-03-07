import { describe, it, expect } from 'vitest';
import { LivepeerComposeBuilder } from '../services/LivepeerComposeBuilder.js';
import type { LivepeerInferenceConfig } from '../types/index.js';

describe('LivepeerComposeBuilder', () => {
  const builder = new LivepeerComposeBuilder();

  describe('deriveCapabilityName', () => {
    it('derives from fal.ai model ID', () => {
      const config: LivepeerInferenceConfig = {
        topology: 'split-cpu-serverless',
        serverlessModelId: 'fal-ai/flux/dev',
      };
      expect(builder.deriveCapabilityName(config)).toBe('flux-dev');
    });

    it('derives from HuggingFace model ID', () => {
      const config: LivepeerInferenceConfig = {
        topology: 'all-in-one',
        serverlessModelId: 'meta-llama/Llama-3.1-70B-Instruct',
      };
      expect(builder.deriveCapabilityName(config)).toBe('meta-llama-llama-3-1-70b-instruct');
    });

    it('derives from simple model name', () => {
      const config: LivepeerInferenceConfig = {
        topology: 'split-cpu-serverless',
        serverlessModelId: 'whisper-v3',
      };
      expect(builder.deriveCapabilityName(config)).toBe('whisper-v3');
    });

    it('derives from Docker image', () => {
      const config: LivepeerInferenceConfig = {
        topology: 'all-in-one',
        modelImage: 'ghcr.io/huggingface/text-generation-inference',
      };
      expect(builder.deriveCapabilityName(config)).toBe('huggingface-text-generation-inference');
    });

    it('falls back to inference when no model info', () => {
      const config: LivepeerInferenceConfig = {
        topology: 'split-cpu-serverless',
      };
      expect(builder.deriveCapabilityName(config)).toBe('inference');
    });

    it('sanitizes special characters', () => {
      const config: LivepeerInferenceConfig = {
        topology: 'split-cpu-serverless',
        serverlessModelId: 'provider/Model_Name.v2@latest',
      };
      const name = builder.deriveCapabilityName(config);
      expect(name).toMatch(/^[a-z0-9-]+$/);
      expect(name).not.toContain('_');
      expect(name).not.toContain('.');
      expect(name).not.toContain('@');
    });

    it('truncates to 63 characters', () => {
      const config: LivepeerInferenceConfig = {
        topology: 'split-cpu-serverless',
        serverlessModelId: 'org/' + 'a'.repeat(100),
      };
      expect(builder.deriveCapabilityName(config).length).toBeLessThanOrEqual(63);
    });
  });

  describe('build - Topology 3 (split-cpu-serverless)', () => {
    const config: LivepeerInferenceConfig = {
      topology: 'split-cpu-serverless',
      serverlessProvider: 'fal-ai',
      serverlessModelId: 'fal-ai/flux/dev',
      serverlessApiKey: 'test-key-123',
      capacity: 4,
      pricePerUnit: 2000,
      publicAddress: '203.0.113.1:7935',
    };

    it('generates valid YAML with 3 services', () => {
      const result = builder.build(config);

      expect(result.yaml).toContain('go-livepeer');
      expect(result.yaml).toContain('inference-adapter');
      expect(result.yaml).toContain('serverless-proxy');
    });

    it('auto-wires ORCH_URL to compose service name', () => {
      const result = builder.build(config);
      expect(result.yaml).toContain('http://go-livepeer:7935');
    });

    it('auto-wires BACKEND_URL to serverless-proxy', () => {
      const result = builder.build(config);
      expect(result.yaml).toContain('http://serverless-proxy:8080');
    });

    it('shares the same ORCH_SECRET between go-livepeer and adapter', () => {
      const result = builder.build(config);
      // The secret appears twice (once for go-livepeer command, once for adapter env)
      const secretMatches = result.yaml.match(new RegExp(result.orchestratorSecret, 'g'));
      expect(secretMatches).not.toBeNull();
      expect(secretMatches!.length).toBeGreaterThanOrEqual(2);
    });

    it('derives capability name from model', () => {
      const result = builder.build(config);
      expect(result.capabilityName).toBe('flux-dev');
    });

    it('generates a project name', () => {
      const result = builder.build(config);
      expect(result.project).toMatch(/^naap-livepeer-/);
    });

    it('auto-generates orchestrator secret', () => {
      const result = builder.build(config);
      expect(result.orchestratorSecret).toBeTruthy();
      expect(result.orchestratorSecret.length).toBeGreaterThan(10);
    });

    it('includes fal.ai provider env vars', () => {
      const result = builder.build(config);
      expect(result.yaml).toContain('FAL_KEY');
      expect(result.yaml).toContain('FAL_MODEL_ID');
      expect(result.yaml).toContain('fal-ai/flux/dev');
    });

    it('includes capacity and price', () => {
      const result = builder.build(config);
      expect(result.yaml).toContain("'4'");
      expect(result.yaml).toContain("'2000'");
    });

    it('uses provided orchestrator secret when given', () => {
      const configWithSecret = { ...config, orchestratorSecret: 'my-fixed-secret' };
      const result = builder.build(configWithSecret);
      expect(result.orchestratorSecret).toBe('my-fixed-secret');
      expect(result.yaml).toContain('my-fixed-secret');
    });

    it('uses provided capability name when given', () => {
      const configWithName = { ...config, capabilityName: 'my-custom-cap' };
      const result = builder.build(configWithName);
      expect(result.capabilityName).toBe('my-custom-cap');
      expect(result.yaml).toContain('my-custom-cap');
    });
  });

  describe('build - Topology 1 (all-in-one)', () => {
    const config: LivepeerInferenceConfig = {
      topology: 'all-in-one',
      modelImage: 'ghcr.io/huggingface/text-generation-inference:latest',
      serverlessModelId: 'meta-llama/Llama-3.1-70B-Instruct',
      publicAddress: '10.0.0.1:7935',
    };

    it('generates YAML with model service instead of serverless-proxy', () => {
      const result = builder.build(config);
      expect(result.yaml).toContain('go-livepeer');
      expect(result.yaml).toContain('inference-adapter');
      expect(result.yaml).toContain('model');
      expect(result.yaml).not.toContain('serverless-proxy');
    });

    it('auto-wires BACKEND_URL to model service', () => {
      const result = builder.build(config);
      expect(result.yaml).toContain('http://model:8080');
    });

    it('includes GPU reservation', () => {
      const result = builder.build(config);
      expect(result.yaml).toContain('nvidia');
      expect(result.yaml).toContain('gpu');
    });

    it('includes model image', () => {
      const result = builder.build(config);
      expect(result.yaml).toContain('ghcr.io/huggingface/text-generation-inference');
    });
  });

  describe('build - Topology 2 (all-on-provider)', () => {
    const config: LivepeerInferenceConfig = {
      topology: 'all-on-provider',
      modelImage: 'ghcr.io/huggingface/text-generation-inference:latest',
    };

    it('does not include GPU reservation (provider handles it)', () => {
      const result = builder.build(config);
      expect(result.yaml).toContain('model');
      // Topology 2 removes the deploy.resources GPU reservation
      expect(result.yaml).not.toContain('reservations');
    });
  });

  describe('YAML sanitization', () => {
    it('quotes strings with YAML special characters', () => {
      const config: LivepeerInferenceConfig = {
        topology: 'split-cpu-serverless',
        serverlessProvider: 'custom',
        serverlessEndpointUrl: 'http://example.com:8080/api?key=value&foo=bar',
        capabilityName: 'test-model',
      };
      const result = builder.build(config);
      // URL with special chars should be quoted
      expect(result.yaml).toContain("'http://example.com:8080/api?key=value&foo=bar'");
    });

    it('handles replicate provider env vars', () => {
      const config: LivepeerInferenceConfig = {
        topology: 'split-cpu-serverless',
        serverlessProvider: 'replicate',
        serverlessModelId: 'stability-ai/sdxl',
        serverlessApiKey: 'r8_abc123',
      };
      const result = builder.build(config);
      expect(result.yaml).toContain('REPLICATE_API_TOKEN');
      expect(result.yaml).toContain('REPLICATE_MODEL');
    });

    it('handles runpod provider env vars', () => {
      const config: LivepeerInferenceConfig = {
        topology: 'split-cpu-serverless',
        serverlessProvider: 'runpod',
        serverlessModelId: 'endpoint-123',
        serverlessApiKey: 'rp_key',
      };
      const result = builder.build(config);
      expect(result.yaml).toContain('RUNPOD_API_KEY');
      expect(result.yaml).toContain('RUNPOD_ENDPOINT_ID');
    });
  });
});
