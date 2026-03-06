import { describe, it, expect } from 'vitest';
import { ProviderAdapterRegistry } from '../services/ProviderAdapterRegistry.js';
import { RunPodAdapter } from '../adapters/RunPodAdapter.js';
import { SshBridgeAdapter } from '../adapters/SshBridgeAdapter.js';
import { FalAdapter } from '../adapters/FalAdapter.js';
import { BasetenAdapter } from '../adapters/BasetenAdapter.js';
import { ModalAdapter } from '../adapters/ModalAdapter.js';
import { ReplicateAdapter } from '../adapters/ReplicateAdapter.js';

describe('ProviderAdapterRegistry', () => {
  it('should register and retrieve adapters', () => {
    const registry = new ProviderAdapterRegistry();
    registry.register(new RunPodAdapter());
    registry.register(new SshBridgeAdapter());

    expect(registry.has('runpod')).toBe(true);
    expect(registry.has('ssh-bridge')).toBe(true);
    expect(registry.has('nonexistent')).toBe(false);
  });

  it('should throw on duplicate registration', () => {
    const registry = new ProviderAdapterRegistry();
    registry.register(new RunPodAdapter());
    expect(() => registry.register(new RunPodAdapter())).toThrow('already registered');
  });

  it('should throw on unknown provider', () => {
    const registry = new ProviderAdapterRegistry();
    expect(() => registry.get('nonexistent')).toThrow('Unknown provider');
  });

  it('should list all providers', () => {
    const registry = new ProviderAdapterRegistry();
    registry.register(new RunPodAdapter());
    registry.register(new SshBridgeAdapter());
    registry.register(new FalAdapter());
    registry.register(new BasetenAdapter());
    registry.register(new ModalAdapter());
    registry.register(new ReplicateAdapter());

    const providers = registry.listProviders();
    expect(providers).toHaveLength(6);
    expect(providers.map((p) => p.slug).sort()).toEqual([
      'baseten', 'fal-ai', 'modal', 'replicate', 'runpod', 'ssh-bridge',
    ]);
  });
});

describe('Adapter GPU options', () => {
  it('RunPod should return fallback GPU options', async () => {
    const adapter = new RunPodAdapter();
    const options = await adapter.getGpuOptions();
    expect(options.length).toBeGreaterThan(0);
    expect(options[0]).toHaveProperty('id');
    expect(options[0]).toHaveProperty('vramGb');
  });

  it('SSH Bridge should return static GPU options', async () => {
    const adapter = new SshBridgeAdapter();
    const options = await adapter.getGpuOptions();
    expect(options.length).toBeGreaterThan(0);
    expect(options.some((o) => o.id === 'custom')).toBe(true);
  });

  it('Fal should return GPU options', async () => {
    const adapter = new FalAdapter();
    const options = await adapter.getGpuOptions();
    expect(options.length).toBeGreaterThan(0);
  });

  it('All adapters should have correct mode', () => {
    expect(new RunPodAdapter().mode).toBe('serverless');
    expect(new FalAdapter().mode).toBe('serverless');
    expect(new BasetenAdapter().mode).toBe('serverless');
    expect(new ModalAdapter().mode).toBe('serverless');
    expect(new ReplicateAdapter().mode).toBe('serverless');
    expect(new SshBridgeAdapter().mode).toBe('ssh-bridge');
  });

  it('SSH Bridge deploy should require sshHost', async () => {
    const adapter = new SshBridgeAdapter();
    await expect(adapter.deploy({
      name: 'test',
      providerSlug: 'ssh-bridge',
      gpuModel: 'A100',
      gpuVramGb: 80,
      gpuCount: 1,
      artifactType: 'ai-runner',
      artifactVersion: 'v0.14.1',
      dockerImage: 'livepeer/ai-runner:v0.14.1',
    })).rejects.toThrow('SSH host and username are required');
  });
});
