import type { IProviderAdapter } from './IProviderAdapter.js';
import type {
  GpuOption,
  DeployConfig,
  UpdateConfig,
  ProviderDeployment,
  ProviderStatus,
  HealthResult,
} from '../types/index.js';

const GATEWAY_BASE = process.env.SHELL_URL || 'http://localhost:3000';

async function gwFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const url = `${GATEWAY_BASE}/api/v1/gw/runpod-serverless${path}`;
  return fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });
}

export class RunPodAdapter implements IProviderAdapter {
  readonly slug = 'runpod';
  readonly displayName = 'RunPod Serverless GPU';
  readonly connectorSlug = 'runpod-serverless';
  readonly mode = 'serverless' as const;
  readonly icon = '🚀';
  readonly description = 'Deploy serverless GPU endpoints on RunPod with custom Docker images.';
  readonly authMethod = 'api-key';

  async getGpuOptions(): Promise<GpuOption[]> {
    try {
      const res = await gwFetch('/gpu-types');
      if (!res.ok) return this.fallbackGpuOptions();
      const data = await res.json();
      if (Array.isArray(data)) {
        return data.map((gpu: any) => ({
          id: gpu.id || gpu.gpuTypeId,
          name: gpu.displayName || gpu.id,
          vramGb: gpu.memoryInGb || 0,
          cudaVersion: gpu.cudaVersion,
          available: gpu.available !== false,
          pricePerHour: gpu.securePrice || gpu.communityPrice,
        }));
      }
      return this.fallbackGpuOptions();
    } catch {
      return this.fallbackGpuOptions();
    }
  }

  async deploy(config: DeployConfig): Promise<ProviderDeployment> {
    const res = await gwFetch('/endpoints', {
      method: 'POST',
      body: JSON.stringify({
        name: config.name,
        templateId: null,
        dockerImage: config.dockerImage,
        gpuTypeId: config.gpuModel,
        gpuCount: config.gpuCount,
        volumeInGb: 20,
        containerDiskInGb: 20,
        minWorkers: 0,
        maxWorkers: 1,
        idleTimeout: 300,
        env: config.artifactConfig || {},
      }),
    });

    if (!res.ok) {
      const error = await res.text();
      throw new Error(`RunPod deploy failed (${res.status}): ${error}`);
    }

    const data = await res.json();
    return {
      providerDeploymentId: data.id,
      endpointUrl: `https://api.runpod.ai/v2/${data.id}`,
      status: 'DEPLOYING',
      metadata: data,
    };
  }

  async getStatus(providerDeploymentId: string): Promise<ProviderStatus> {
    const res = await gwFetch(`/endpoints/${providerDeploymentId}`);
    if (!res.ok) {
      return { status: 'FAILED' };
    }
    const data = await res.json();
    const statusMap: Record<string, ProviderStatus['status']> = {
      READY: 'ONLINE',
      INITIALIZING: 'DEPLOYING',
      UNHEALTHY: 'DEGRADED',
      OFFLINE: 'OFFLINE',
    };
    return {
      status: statusMap[data.status] || 'DEPLOYING',
      endpointUrl: `https://api.runpod.ai/v2/${providerDeploymentId}`,
      metadata: data,
    };
  }

  async destroy(providerDeploymentId: string): Promise<void> {
    const res = await gwFetch(`/endpoints/${providerDeploymentId}`, { method: 'DELETE' });
    if (!res.ok && res.status !== 404) {
      const error = await res.text();
      throw new Error(`RunPod destroy failed (${res.status}): ${error}`);
    }
  }

  async update(providerDeploymentId: string, config: UpdateConfig): Promise<ProviderDeployment> {
    const body: Record<string, unknown> = {};
    if (config.dockerImage) body.dockerImage = config.dockerImage;
    if (config.gpuModel) body.gpuTypeId = config.gpuModel;
    if (config.gpuCount) body.gpuCount = config.gpuCount;

    const res = await gwFetch(`/endpoints/${providerDeploymentId}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const error = await res.text();
      throw new Error(`RunPod update failed (${res.status}): ${error}`);
    }

    const data = await res.json();
    return {
      providerDeploymentId: data.id || providerDeploymentId,
      endpointUrl: `https://api.runpod.ai/v2/${providerDeploymentId}`,
      status: 'UPDATING',
      metadata: data,
    };
  }

  async healthCheck(providerDeploymentId: string): Promise<HealthResult> {
    try {
      const start = Date.now();
      const res = await gwFetch(`/endpoints/${providerDeploymentId}/health`);
      const responseTimeMs = Date.now() - start;

      if (!res.ok) {
        return { healthy: false, status: 'RED', responseTimeMs, statusCode: res.status };
      }

      const data = await res.json();
      const healthy = data.status === 'READY' || data.workers?.running > 0;
      return {
        healthy,
        status: healthy ? (responseTimeMs > 5000 ? 'ORANGE' : 'GREEN') : 'RED',
        responseTimeMs,
        statusCode: res.status,
        details: data,
      };
    } catch {
      return { healthy: false, status: 'RED' };
    }
  }

  private fallbackGpuOptions(): GpuOption[] {
    return [
      { id: 'NVIDIA A100 80GB', name: 'NVIDIA A100 80GB', vramGb: 80, available: true },
      { id: 'NVIDIA A100 40GB', name: 'NVIDIA A100 40GB', vramGb: 40, available: true },
      { id: 'NVIDIA H100 80GB', name: 'NVIDIA H100 80GB', vramGb: 80, available: true },
      { id: 'NVIDIA A40', name: 'NVIDIA A40', vramGb: 48, available: true },
      { id: 'NVIDIA L40S', name: 'NVIDIA L40S', vramGb: 48, available: true },
      { id: 'NVIDIA RTX 4090', name: 'NVIDIA RTX 4090', vramGb: 24, available: true },
      { id: 'NVIDIA RTX A6000', name: 'NVIDIA RTX A6000', vramGb: 48, available: true },
      { id: 'NVIDIA T4', name: 'NVIDIA T4', vramGb: 16, available: true },
    ];
  }
}
