import type { ProviderAdapterRegistry } from './ProviderAdapterRegistry.js';

export interface CostEstimate {
  gpuCostPerHour: number;
  totalCostPerHour: number;
  totalCostPerDay: number;
  totalCostPerMonth: number;
  currency: string;
  breakdown: {
    gpu: number;
    storage: number;
    network: number;
  };
  providerSlug: string;
  gpuModel: string;
  gpuCount: number;
}

const PROVIDER_PRICING: Record<string, Record<string, number>> = {
  'fal-ai': {
    'A100': 2.55, 'A100-40GB': 1.50, 'H100': 3.85, 'A10G': 0.75, 'T4': 0.40, 'L4': 0.65,
  },
  'runpod': {
    'NVIDIA GeForce RTX 4090': 0.69, 'NVIDIA A100-SXM4-80GB': 2.49, 'NVIDIA A100 80GB PCIe': 2.49,
    'NVIDIA H100 80GB HBM3': 4.49, 'NVIDIA H200': 5.49, 'NVIDIA A40': 0.79,
    'NVIDIA L40S': 1.14, 'NVIDIA RTX A6000': 0.79, 'NVIDIA L4': 0.39, 'NVIDIA T4': 0.39,
  },
  'replicate': {
    'gpu-a100-large': 3.50, 'gpu-a100-small': 2.30, 'gpu-a40-large': 1.10,
    'gpu-a40-small': 0.55, 'gpu-t4': 0.55,
  },
  'modal': {
    'a100-80gb': 3.73, 'a100-40gb': 2.78, 'h100': 4.89,
    'a10g': 1.10, 'l4': 0.80, 't4': 0.59,
  },
  'baseten': {
    'A100': 2.12, 'A100-80GB': 3.15, 'H100': 4.25, 'A10G': 0.75, 'T4': 0.46,
  },
  'ssh-bridge': {},
};

export class CostEstimationService {
  constructor(private registry: ProviderAdapterRegistry) {}

  async estimate(providerSlug: string, gpuModel: string, gpuCount: number): Promise<CostEstimate> {
    let gpuCostPerHour = 0;

    const providerPricing = PROVIDER_PRICING[providerSlug];
    if (providerPricing && providerPricing[gpuModel] != null) {
      gpuCostPerHour = providerPricing[gpuModel];
    } else {
      try {
        const adapter = this.registry.get(providerSlug);
        const gpuOptions = await adapter.getGpuOptions();
        const gpu = gpuOptions.find(g => g.id === gpuModel);
        if (gpu?.pricePerHour != null) {
          gpuCostPerHour = gpu.pricePerHour;
        }
      } catch {
        // No pricing available
      }
    }

    const totalGpuCost = gpuCostPerHour * gpuCount;
    const storageCost = providerSlug === 'ssh-bridge' ? 0 : 0.10;
    const networkCost = 0;
    const totalCostPerHour = totalGpuCost + storageCost + networkCost;

    return {
      gpuCostPerHour,
      totalCostPerHour,
      totalCostPerDay: totalCostPerHour * 24,
      totalCostPerMonth: totalCostPerHour * 24 * 30,
      currency: 'USD',
      breakdown: {
        gpu: totalGpuCost,
        storage: storageCost,
        network: networkCost,
      },
      providerSlug,
      gpuModel,
      gpuCount,
    };
  }
}
