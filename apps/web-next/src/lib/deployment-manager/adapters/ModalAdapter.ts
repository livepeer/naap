import type { IProviderAdapter } from './IProviderAdapter';
import type { ProviderApiConfig, GpuOption, DeployConfig, UpdateConfig, ProviderDeployment, ProviderStatus, HealthResult } from '../types';
import { authenticatedProviderFetch } from '../provider-fetch';

export class ModalAdapter implements IProviderAdapter {
  readonly slug = 'modal';
  readonly displayName = 'Modal Serverless GPU';
  readonly mode = 'serverless' as const;
  readonly icon = '🔮';
  readonly description = 'Serverless GPU infrastructure on Modal with elastic scaling.';
  readonly authMethod = 'token';
  readonly apiConfig: ProviderApiConfig = {
    upstreamBaseUrl: 'https://api.modal.com/v1',
    authType: 'bearer',
    authHeaderTemplate: 'Bearer {{secret}}',
    secretNames: ['api-key'],
    healthCheckPath: '/apps',
  };

  private fetch(path: string, options: RequestInit = {}) {
    return authenticatedProviderFetch(this.slug, this.apiConfig, path, options);
  }

  async getGpuOptions(): Promise<GpuOption[]> {
    return [
      { id: 'a100-80gb', name: 'NVIDIA A100 80GB', vramGb: 80, available: true, pricePerHour: 3.73 },
      { id: 'a100-40gb', name: 'NVIDIA A100 40GB', vramGb: 40, available: true, pricePerHour: 2.78 },
      { id: 'h100', name: 'NVIDIA H100', vramGb: 80, available: true, pricePerHour: 4.89 },
      { id: 'a10g', name: 'NVIDIA A10G', vramGb: 24, available: true, pricePerHour: 1.10 },
      { id: 'l4', name: 'NVIDIA L4', vramGb: 24, available: true, pricePerHour: 0.80 },
      { id: 't4', name: 'NVIDIA T4', vramGb: 16, available: true, pricePerHour: 0.59 },
    ];
  }

  async deploy(config: DeployConfig): Promise<ProviderDeployment> {
    const res = await this.fetch('/apps', {
      method: 'POST',
      body: JSON.stringify({ name: config.name, image: config.dockerImage, gpu: config.gpuModel, gpu_count: config.gpuCount, min_containers: 0, max_containers: 5, timeout: 300 }),
    });
    if (!res.ok) throw new Error(`Modal deploy failed (${res.status}): ${await res.text()}`);
    const data = await res.json();
    return {
      providerDeploymentId: data.app_id || data.id,
      endpointUrl: data.web_url || `https://${config.name}--serve.modal.run`,
      status: 'DEPLOYING', metadata: data,
    };
  }

  async getStatus(providerDeploymentId: string): Promise<ProviderStatus> {
    const res = await this.fetch(`/apps/${providerDeploymentId}`);
    if (!res.ok) return { status: 'FAILED' };
    const data = await res.json();
    const statusMap: Record<string, ProviderStatus['status']> = { deployed: 'ONLINE', deploying: 'DEPLOYING', stopped: 'OFFLINE', errored: 'FAILED' };
    return { status: statusMap[data.state || data.status] || 'DEPLOYING', endpointUrl: data.web_url, metadata: data };
  }

  async destroy(providerDeploymentId: string): Promise<void> {
    const res = await this.fetch(`/apps/${providerDeploymentId}`, { method: 'DELETE' });
    if (!res.ok && res.status !== 404) throw new Error(`Modal destroy failed (${res.status})`);
  }

  async update(providerDeploymentId: string, config: UpdateConfig): Promise<ProviderDeployment> {
    const body: Record<string, unknown> = {};
    if (config.dockerImage) body.image = config.dockerImage;
    if (config.gpuModel) body.gpu = config.gpuModel;
    const res = await this.fetch(`/apps/${providerDeploymentId}`, { method: 'PUT', body: JSON.stringify(body) });
    if (!res.ok) throw new Error(`Modal update failed (${res.status})`);
    const data = await res.json();
    return { providerDeploymentId, endpointUrl: data.web_url, status: 'UPDATING', metadata: data };
  }

  async healthCheck(providerDeploymentId: string): Promise<HealthResult> {
    try {
      const start = Date.now();
      const res = await this.fetch(`/apps/${providerDeploymentId}`);
      const responseTimeMs = Date.now() - start;
      if (!res.ok) return { healthy: false, status: 'RED', responseTimeMs, statusCode: res.status };
      const data = await res.json();
      const healthy = (data.state || data.status) === 'deployed';
      return { healthy, status: healthy ? (responseTimeMs > 5000 ? 'ORANGE' : 'GREEN') : 'RED', responseTimeMs, statusCode: res.status, details: data };
    } catch { return { healthy: false, status: 'RED' }; }
  }
}
