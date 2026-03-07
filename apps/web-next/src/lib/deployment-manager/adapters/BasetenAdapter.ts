import type { IProviderAdapter } from './IProviderAdapter';
import type { ProviderApiConfig, GpuOption, DeployConfig, UpdateConfig, ProviderDeployment, ProviderStatus, HealthResult } from '../types';
import { authenticatedProviderFetch } from '../provider-fetch';

export class BasetenAdapter implements IProviderAdapter {
  readonly slug = 'baseten';
  readonly displayName = 'Baseten Model Deployment';
  readonly mode = 'serverless' as const;
  readonly icon = '🏗️';
  readonly description = 'Deploy ML models as scalable API endpoints on Baseten.';
  readonly authMethod = 'api-key';
  readonly apiConfig: ProviderApiConfig = {
    upstreamBaseUrl: 'https://api.baseten.co/v1',
    authType: 'bearer',
    authHeaderTemplate: 'Bearer {{secret}}',
    secretNames: ['api-key'],
    healthCheckPath: '/models',
  };

  private fetch(path: string, options: RequestInit = {}) {
    return authenticatedProviderFetch(this.slug, this.apiConfig, path, options);
  }

  async getGpuOptions(): Promise<GpuOption[]> {
    return [
      { id: 'A100', name: 'NVIDIA A100 40GB', vramGb: 40, available: true, pricePerHour: 2.12 },
      { id: 'A100-80GB', name: 'NVIDIA A100 80GB', vramGb: 80, available: true, pricePerHour: 3.15 },
      { id: 'H100', name: 'NVIDIA H100 80GB', vramGb: 80, available: true, pricePerHour: 4.25 },
      { id: 'A10G', name: 'NVIDIA A10G', vramGb: 24, available: true, pricePerHour: 0.75 },
      { id: 'T4', name: 'NVIDIA T4', vramGb: 16, available: true, pricePerHour: 0.46 },
    ];
  }

  async deploy(config: DeployConfig): Promise<ProviderDeployment> {
    const res = await this.fetch('/models', {
      method: 'POST',
      body: JSON.stringify({ name: config.name, docker_image: config.dockerImage, gpu: config.gpuModel, min_replica: 0, max_replica: 3, autoscaling_window: 300 }),
    });
    if (!res.ok) throw new Error(`Baseten deploy failed (${res.status}): ${await res.text()}`);
    const data = await res.json();
    return {
      providerDeploymentId: data.model_id || data.id,
      endpointUrl: data.url || `https://model-${data.model_id}.api.baseten.co/production/predict`,
      status: 'DEPLOYING', metadata: data,
    };
  }

  async getStatus(providerDeploymentId: string): Promise<ProviderStatus> {
    const res = await this.fetch(`/models/${providerDeploymentId}`);
    if (!res.ok) return { status: 'FAILED' };
    const data = await res.json();
    const statusMap: Record<string, ProviderStatus['status']> = { ACTIVE: 'ONLINE', BUILDING: 'DEPLOYING', SCALING: 'DEPLOYING', FAILED: 'FAILED', STOPPED: 'OFFLINE' };
    return { status: statusMap[data.status] || 'DEPLOYING', endpointUrl: data.url, metadata: data };
  }

  async destroy(providerDeploymentId: string): Promise<void> {
    const res = await this.fetch(`/models/${providerDeploymentId}`, { method: 'DELETE' });
    if (!res.ok && res.status !== 404) throw new Error(`Baseten destroy failed (${res.status})`);
  }

  async update(providerDeploymentId: string, config: UpdateConfig): Promise<ProviderDeployment> {
    const body: Record<string, unknown> = {};
    if (config.dockerImage) body.docker_image = config.dockerImage;
    const res = await this.fetch(`/models/${providerDeploymentId}`, { method: 'PATCH', body: JSON.stringify(body) });
    if (!res.ok) throw new Error(`Baseten update failed (${res.status})`);
    const data = await res.json();
    return { providerDeploymentId, endpointUrl: data.url, status: 'UPDATING', metadata: data };
  }

  async healthCheck(providerDeploymentId: string): Promise<HealthResult> {
    try {
      const start = Date.now();
      const res = await this.fetch(`/models/${providerDeploymentId}`);
      const responseTimeMs = Date.now() - start;
      if (!res.ok) return { healthy: false, status: 'RED', responseTimeMs, statusCode: res.status };
      const data = await res.json();
      const healthy = data.status === 'ACTIVE';
      return { healthy, status: healthy ? (responseTimeMs > 5000 ? 'ORANGE' : 'GREEN') : 'RED', responseTimeMs, statusCode: res.status, details: data };
    } catch { return { healthy: false, status: 'RED' }; }
  }
}
