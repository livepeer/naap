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
  return fetch(`${GATEWAY_BASE}/api/v1/gw/fal-ai${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options.headers },
  });
}

export class FalAdapter implements IProviderAdapter {
  readonly slug = 'fal-ai';
  readonly displayName = 'fal.ai Serverless GPU';
  readonly connectorSlug = 'fal-ai-serverless';
  readonly mode = 'serverless' as const;
  readonly icon = '⚡';
  readonly description = 'Serverless GPU inference with sub-second cold starts on fal.ai.';
  readonly authMethod = 'api-key';

  async getGpuOptions(): Promise<GpuOption[]> {
    return [
      { id: 'A100', name: 'NVIDIA A100 80GB', vramGb: 80, available: true },
      { id: 'A100-40GB', name: 'NVIDIA A100 40GB', vramGb: 40, available: true },
      { id: 'H100', name: 'NVIDIA H100 80GB', vramGb: 80, available: true },
      { id: 'A10G', name: 'NVIDIA A10G', vramGb: 24, available: true },
      { id: 'T4', name: 'NVIDIA T4', vramGb: 16, available: true },
      { id: 'L4', name: 'NVIDIA L4', vramGb: 24, available: true },
    ];
  }

  async deploy(config: DeployConfig): Promise<ProviderDeployment> {
    const res = await gwFetch('/applications', {
      method: 'POST',
      body: JSON.stringify({
        name: config.name,
        image: config.dockerImage,
        machine_type: config.gpuModel,
        min_concurrency: 0,
        max_concurrency: 5,
      }),
    });

    if (!res.ok) {
      const error = await res.text();
      throw new Error(`fal.ai deploy failed (${res.status}): ${error}`);
    }

    const data = await res.json();
    return {
      providerDeploymentId: data.id || data.application_id,
      endpointUrl: data.url || `https://fal.run/${data.id}`,
      status: 'DEPLOYING',
      metadata: data,
    };
  }

  async getStatus(providerDeploymentId: string): Promise<ProviderStatus> {
    const res = await gwFetch(`/applications/${providerDeploymentId}`);
    if (!res.ok) return { status: 'FAILED' };

    const data = await res.json();
    const statusMap: Record<string, ProviderStatus['status']> = {
      ACTIVE: 'ONLINE', DEPLOYING: 'DEPLOYING', FAILED: 'FAILED', STOPPED: 'FAILED',
    };
    return {
      status: statusMap[data.status] || 'DEPLOYING',
      endpointUrl: data.url,
      metadata: data,
    };
  }

  async destroy(providerDeploymentId: string): Promise<void> {
    const res = await gwFetch(`/applications/${providerDeploymentId}`, { method: 'DELETE' });
    if (!res.ok && res.status !== 404) {
      throw new Error(`fal.ai destroy failed (${res.status})`);
    }
  }

  async update(providerDeploymentId: string, config: UpdateConfig): Promise<ProviderDeployment> {
    const body: Record<string, unknown> = {};
    if (config.dockerImage) body.image = config.dockerImage;

    const res = await gwFetch(`/applications/${providerDeploymentId}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    });

    if (!res.ok) throw new Error(`fal.ai update failed (${res.status})`);

    const data = await res.json();
    return {
      providerDeploymentId,
      endpointUrl: data.url,
      status: 'UPDATING',
      metadata: data,
    };
  }

  async healthCheck(providerDeploymentId: string, endpointUrl?: string): Promise<HealthResult> {
    try {
      const start = Date.now();
      const res = await gwFetch(`/applications/${providerDeploymentId}`);
      const responseTimeMs = Date.now() - start;

      if (!res.ok) return { healthy: false, status: 'RED', responseTimeMs, statusCode: res.status };

      const data = await res.json();
      const healthy = data.status === 'ACTIVE';
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
}
