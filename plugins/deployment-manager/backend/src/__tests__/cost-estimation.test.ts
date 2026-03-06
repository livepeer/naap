import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CostEstimationService } from '../services/CostEstimationService.js';
import { ProviderAdapterRegistry } from '../services/ProviderAdapterRegistry.js';
import type { IProviderAdapter } from '../adapters/IProviderAdapter.js';

function makeMockAdapter(slug: string, gpuOptions: { id: string; pricePerHour: number }[] = []): IProviderAdapter {
  return {
    slug,
    displayName: slug,
    mode: 'serverless' as const,
    icon: 'T',
    description: 'Test',
    authMethod: 'api-key',
    apiConfig: { upstreamBaseUrl: 'http://mock', authType: 'bearer' as const, secretNames: ['api-key'], healthCheckPath: null },
    getGpuOptions: vi.fn().mockResolvedValue(
      gpuOptions.map((g) => ({ id: g.id, name: g.id, vramGb: 24, available: true, pricePerHour: g.pricePerHour })),
    ),
    deploy: vi.fn(),
    getStatus: vi.fn(),
    destroy: vi.fn(),
    update: vi.fn(),
    healthCheck: vi.fn(),
  };
}

describe('CostEstimationService', () => {
  let service: CostEstimationService;
  let registry: ProviderAdapterRegistry;

  beforeEach(() => {
    registry = new ProviderAdapterRegistry();
    service = new CostEstimationService(registry);
  });

  it('returns correct cost for fal-ai A100', async () => {
    const estimate = await service.estimate('fal-ai', 'A100', 1);
    expect(estimate.gpuCostPerHour).toBe(2.55);
    expect(estimate.totalCostPerHour).toBe(2.55 + 0.10);
    expect(estimate.currency).toBe('USD');
    expect(estimate.gpuCount).toBe(1);
  });

  it('returns correct cost for runpod NVIDIA A100 80GB PCIe', async () => {
    const estimate = await service.estimate('runpod', 'NVIDIA A100 80GB PCIe', 1);
    expect(estimate.gpuCostPerHour).toBe(2.49);
    expect(estimate.breakdown.gpu).toBe(2.49);
  });

  it('returns correct cost for replicate gpu-a100-large', async () => {
    const estimate = await service.estimate('replicate', 'gpu-a100-large', 1);
    expect(estimate.gpuCostPerHour).toBe(3.50);
  });

  it('returns correct cost for modal h100', async () => {
    const estimate = await service.estimate('modal', 'h100', 1);
    expect(estimate.gpuCostPerHour).toBe(4.89);
  });

  it('returns correct cost for baseten A100', async () => {
    const estimate = await service.estimate('baseten', 'A100', 1);
    expect(estimate.gpuCostPerHour).toBe(2.12);
  });

  it('multiplies breakdown.gpu by gpuCount', async () => {
    const single = await service.estimate('fal-ai', 'A100', 1);
    const double = await service.estimate('fal-ai', 'A100', 2);
    expect(double.breakdown.gpu).toBe(single.breakdown.gpu * 2);
    expect(double.gpuCount).toBe(2);
  });

  it('returns 0 GPU cost and 0 storage for ssh-bridge', async () => {
    const estimate = await service.estimate('ssh-bridge', 'any-gpu', 1);
    expect(estimate.gpuCostPerHour).toBe(0);
    expect(estimate.breakdown.storage).toBe(0);
    expect(estimate.totalCostPerHour).toBe(0);
  });

  it('falls back to adapter GPU options pricing when provider pricing not found', async () => {
    registry.register(makeMockAdapter('test-provider', [{ id: 'test-gpu', pricePerHour: 1.50 }]));
    const estimate = await service.estimate('test-provider', 'test-gpu', 1);
    expect(estimate.gpuCostPerHour).toBe(1.50);
  });

  it('calculates daily and monthly costs correctly', async () => {
    const estimate = await service.estimate('modal', 'h100', 1);
    expect(estimate.totalCostPerDay).toBeCloseTo(estimate.totalCostPerHour * 24, 2);
    expect(estimate.totalCostPerMonth).toBeCloseTo(estimate.totalCostPerHour * 24 * 30, 2);
  });

  it('includes storage cost for serverless providers', async () => {
    const estimate = await service.estimate('runpod', 'NVIDIA A100 80GB PCIe', 1);
    expect(estimate.breakdown.storage).toBe(0.10);
  });

  it('returns 0 GPU cost when GPU model is unknown and no adapter pricing', async () => {
    const estimate = await service.estimate('fal-ai', 'UNKNOWN_GPU', 1);
    expect(estimate.gpuCostPerHour).toBe(0);
    expect(estimate.breakdown.gpu).toBe(0);
  });

  it('returns 0 when provider is unknown and not in registry', async () => {
    const estimate = await service.estimate('no-such-provider', 'any-gpu', 1);
    expect(estimate.gpuCostPerHour).toBe(0);
  });

  it('totalCostPerHour includes gpu + storage + network', async () => {
    const estimate = await service.estimate('fal-ai', 'A100', 2);
    const expected = 2.55 * 2 + 0.10 + 0;
    expect(estimate.totalCostPerHour).toBeCloseTo(expected, 2);
  });

  it('preserves providerSlug and gpuModel in the response', async () => {
    const estimate = await service.estimate('baseten', 'H100', 1);
    expect(estimate.providerSlug).toBe('baseten');
    expect(estimate.gpuModel).toBe('H100');
  });
});
