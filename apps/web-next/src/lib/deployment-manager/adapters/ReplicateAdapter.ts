import type { IProviderAdapter } from './IProviderAdapter';
import type { ProviderApiConfig, GpuOption, DeployConfig, UpdateConfig, ProviderDeployment, ProviderStatus, HealthResult } from '../types';
import { authenticatedProviderFetch } from '../provider-fetch';

export class ReplicateAdapter implements IProviderAdapter {
  readonly slug = 'replicate';
  readonly displayName = 'Replicate Deployments';
  readonly mode = 'serverless' as const;
  readonly icon = '🔁';
  readonly description = 'Deploy custom models as scalable endpoints on Replicate.';
  readonly authMethod = 'api-key';
  readonly apiConfig: ProviderApiConfig = {
    upstreamBaseUrl: 'https://api.replicate.com/v1',
    authType: 'bearer',
    authHeaderTemplate: 'Bearer {{secret}}',
    secretNames: ['api-key'],
    healthCheckPath: '/deployments',
  };

  private fetch(path: string, options: RequestInit = {}) {
    return authenticatedProviderFetch(this.slug, this.apiConfig, path, options);
  }

  async getGpuOptions(): Promise<GpuOption[]> {
    return [
      { id: 'gpu-a100-large', name: 'NVIDIA A100 80GB', vramGb: 80, available: true, pricePerHour: 3.50 },
      { id: 'gpu-a100-small', name: 'NVIDIA A100 40GB', vramGb: 40, available: true, pricePerHour: 2.30 },
      { id: 'gpu-a40-large', name: 'NVIDIA A40 48GB', vramGb: 48, available: true, pricePerHour: 1.10 },
      { id: 'gpu-a40-small', name: 'NVIDIA A40 24GB', vramGb: 24, available: true, pricePerHour: 0.55 },
      { id: 'gpu-t4', name: 'NVIDIA T4', vramGb: 16, available: true, pricePerHour: 0.55 },
    ];
  }

  async deploy(config: DeployConfig): Promise<ProviderDeployment> {
    const owner = 'naap';
    const name = config.name.replace(/[^a-z0-9-]/g, '-');
    const res = await this.fetch('/deployments', {
      method: 'POST',
      body: JSON.stringify({ owner, name, model: config.dockerImage, hardware: config.gpuModel, min_instances: 0, max_instances: 3 }),
    });
    if (!res.ok) throw new Error(`Replicate deploy failed (${res.status}): ${await res.text()}`);
    const data = await res.json();
    return {
      providerDeploymentId: `${owner}/${name}`,
      endpointUrl: data.current_release?.url || `https://api.replicate.com/v1/deployments/${owner}/${name}/predictions`,
      status: 'DEPLOYING', metadata: data,
    };
  }

  async getStatus(providerDeploymentId: string): Promise<ProviderStatus> {
    const [owner, name] = providerDeploymentId.split('/');
    const res = await this.fetch(`/deployments/${owner}/${name}`);
    if (!res.ok) return { status: 'FAILED' };
    const data = await res.json();
    return { status: data.current_release ? 'ONLINE' : 'DEPLOYING', endpointUrl: data.current_release?.url, metadata: data };
  }

  async destroy(providerDeploymentId: string): Promise<void> {
    const [owner, name] = providerDeploymentId.split('/');
    const res = await this.fetch(`/deployments/${owner}/${name}`, { method: 'DELETE' });
    if (!res.ok && res.status !== 404) throw new Error(`Replicate destroy failed (${res.status})`);
  }

  async update(providerDeploymentId: string, config: UpdateConfig): Promise<ProviderDeployment> {
    const [owner, name] = providerDeploymentId.split('/');
    const body: Record<string, unknown> = {};
    if (config.dockerImage) body.model = config.dockerImage;
    if (config.gpuModel) body.hardware = config.gpuModel;
    const res = await this.fetch(`/deployments/${owner}/${name}`, { method: 'PATCH', body: JSON.stringify(body) });
    if (!res.ok) throw new Error(`Replicate update failed (${res.status})`);
    const data = await res.json();
    return { providerDeploymentId, endpointUrl: data.current_release?.url, status: 'UPDATING', metadata: data };
  }

  async healthCheck(providerDeploymentId: string): Promise<HealthResult> {
    try {
      const start = Date.now();
      const [owner, name] = providerDeploymentId.split('/');
      const res = await this.fetch(`/deployments/${owner}/${name}`);
      const responseTimeMs = Date.now() - start;
      if (!res.ok) return { healthy: false, status: 'RED', responseTimeMs, statusCode: res.status };
      const data = await res.json();
      const healthy = !!data.current_release;
      return { healthy, status: healthy ? (responseTimeMs > 5000 ? 'ORANGE' : 'GREEN') : 'RED', responseTimeMs, statusCode: res.status, details: data };
    } catch { return { healthy: false, status: 'RED' }; }
  }
}
