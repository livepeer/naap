import type { IProviderAdapter } from './IProviderAdapter';
import type { ProviderApiConfig, GpuOption, DeployConfig, UpdateConfig, ProviderDeployment, ProviderStatus, HealthResult } from '../types';
import { authenticatedProviderFetch } from '../provider-fetch';

export class RunPodAdapter implements IProviderAdapter {
  readonly slug = 'runpod';
  readonly displayName = 'RunPod Serverless GPU';
  readonly mode = 'serverless' as const;
  readonly icon = '🚀';
  readonly description = 'Deploy serverless GPU endpoints on RunPod with custom Docker images.';
  readonly authMethod = 'api-key';
  readonly apiConfig: ProviderApiConfig = {
    upstreamBaseUrl: 'https://rest.runpod.io/v1',
    authType: 'bearer',
    authHeaderTemplate: 'Bearer {{secret}}',
    secretNames: ['api-key'],
    healthCheckPath: '/endpoints',
  };

  private fetch(path: string, options: RequestInit = {}) {
    return authenticatedProviderFetch(this.slug, this.apiConfig, path, options);
  }

  async getGpuOptions(): Promise<GpuOption[]> {
    try {
      const res = await this.fetch('/gpu-types');
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
    const templateRes = await this.fetch('/templates', {
      method: 'POST',
      body: JSON.stringify({
        name: `${config.name}-tpl-${Date.now()}`,
        imageName: config.dockerImage,
        isServerless: true,
        containerDiskInGb: 20,
        volumeInGb: 20,
        env: config.artifactConfig || {},
      }),
    });

    if (!templateRes.ok) {
      const error = await templateRes.text();
      throw new Error(`RunPod template creation failed (${templateRes.status}): ${error}`);
    }

    const template = await templateRes.json();
    const templateId = template.id;

    const endpointRes = await this.fetch('/endpoints', {
      method: 'POST',
      body: JSON.stringify({
        name: config.name,
        templateId,
        gpuTypeIds: config.gpuModel ? [config.gpuModel] : ['NVIDIA GeForce RTX 4090'],
        gpuCount: config.gpuCount || 1,
        workersMin: 0,
        workersMax: 1,
        idleTimeout: 300,
      }),
    });

    if (!endpointRes.ok) {
      const error = await endpointRes.text();
      throw new Error(`RunPod endpoint creation failed (${endpointRes.status}): ${error}`);
    }

    const data = await endpointRes.json();
    return {
      providerDeploymentId: data.id,
      endpointUrl: `https://api.runpod.ai/v2/${data.id}`,
      status: 'DEPLOYING',
      metadata: { ...data, templateId },
    };
  }

  async getStatus(providerDeploymentId: string): Promise<ProviderStatus> {
    const res = await this.fetch(`/endpoints/${providerDeploymentId}`);
    if (!res.ok) return { status: 'FAILED' };
    const data = await res.json();
    const statusMap: Record<string, ProviderStatus['status']> = {
      READY: 'ONLINE',
      INITIALIZING: 'DEPLOYING',
      UNHEALTHY: 'DEGRADED',
      OFFLINE: 'ONLINE',
    };
    return {
      status: statusMap[data.status] || 'DEPLOYING',
      endpointUrl: `https://api.runpod.ai/v2/${providerDeploymentId}`,
      metadata: data,
    };
  }

  async destroy(providerDeploymentId: string): Promise<void> {
    const res = await this.fetch(`/endpoints/${providerDeploymentId}`, { method: 'DELETE' });
    if (!res.ok && res.status !== 404) {
      const error = await res.text();
      throw new Error(`RunPod destroy failed (${res.status}): ${error}`);
    }
  }

  async update(providerDeploymentId: string, config: UpdateConfig): Promise<ProviderDeployment> {
    const body: Record<string, unknown> = {};
    if (config.dockerImage) body.imageName = config.dockerImage;
    if (config.gpuModel) body.gpuTypeIds = [config.gpuModel];
    if (config.gpuCount) body.gpuCount = config.gpuCount;

    const res = await this.fetch(`/endpoints/${providerDeploymentId}`, {
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
      const res = await this.fetch(`/endpoints/${providerDeploymentId}/health`);
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
      { id: 'NVIDIA GeForce RTX 4090', name: 'NVIDIA RTX 4090', vramGb: 24, available: true },
      { id: 'NVIDIA A40', name: 'NVIDIA A40', vramGb: 48, available: true },
      { id: 'NVIDIA L40S', name: 'NVIDIA L40S', vramGb: 48, available: true },
      { id: 'NVIDIA H100 80GB HBM3', name: 'NVIDIA H100 80GB', vramGb: 80, available: true },
      { id: 'NVIDIA H200', name: 'NVIDIA H200', vramGb: 141, available: true },
      { id: 'NVIDIA A100-SXM4-80GB', name: 'NVIDIA A100 80GB', vramGb: 80, available: true },
      { id: 'NVIDIA A100 80GB PCIe', name: 'NVIDIA A100 80GB PCIe', vramGb: 80, available: true },
      { id: 'NVIDIA RTX A6000', name: 'NVIDIA RTX A6000', vramGb: 48, available: true },
      { id: 'NVIDIA L4', name: 'NVIDIA L4', vramGb: 24, available: true },
    ];
  }
}
