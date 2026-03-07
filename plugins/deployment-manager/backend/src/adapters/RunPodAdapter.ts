import type { IProviderAdapter, DestroyResult, DestroyStep } from './IProviderAdapter.js';
import type {
  GpuOption,
  DeployConfig,
  UpdateConfig,
  ProviderDeployment,
  ProviderStatus,
  HealthResult,
  ProviderApiConfig,
} from '../types/index.js';
import { authenticatedProviderFetch } from '../lib/providerFetch.js';

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

  async getGpuOptions(): Promise<GpuOption[]> {
    return this.fallbackGpuOptions();
  }

  async deploy(config: DeployConfig): Promise<ProviderDeployment> {
    const templateRes = await authenticatedProviderFetch(this.slug, this.apiConfig, '/templates', {
      method: 'POST',
      body: JSON.stringify({
        name: `${config.name}-tpl-${Date.now()}`,
        imageName: config.dockerImage,
        isServerless: true,
        containerDiskInGb: 20,
        volumeInGb: 20,
        env: { ...config.artifactConfig, ...config.envVars },
      }),
    });

    if (!templateRes.ok) {
      const error = await templateRes.text();
      throw new Error(`RunPod template creation failed (${templateRes.status}): ${error}`);
    }

    const template = await templateRes.json();
    const templateId = template.id;

    const endpointRes = await authenticatedProviderFetch(this.slug, this.apiConfig, '/endpoints', {
      method: 'POST',
      body: JSON.stringify({
        name: config.name,
        templateId,
        gpuTypeIds: config.gpuModel ? [config.gpuModel] : ['NVIDIA GeForce RTX 4090'],
        gpuCount: config.gpuCount || 1,
        workersMin: 0,
        workersMax: config.concurrency || 1,
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
    const res = await authenticatedProviderFetch(this.slug, this.apiConfig, `/endpoints/${providerDeploymentId}`);
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.error(`[RunPodAdapter.getStatus] API returned ${res.status} for ${providerDeploymentId}: ${body}`);
      return { status: 'FAILED', metadata: { error: `RunPod API returned ${res.status}`, body } };
    }
    const data = await res.json();
    const rawStatus = data.status || 'UNKNOWN';
    console.log(`[RunPodAdapter.getStatus] ${providerDeploymentId}: rawStatus=${rawStatus}, workers=${JSON.stringify({ running: data.workersRunning, total: data.workersTotal, min: data.workersMin })}`);

    if (rawStatus === 'INITIALIZING' && data.workersTotal > 0) {
      const hasRunning = (data.workersRunning || 0) > 0;
      if (!hasRunning) {
        const createdAt = data.createdAt ? new Date(data.createdAt).getTime() : 0;
        const ageMinutes = createdAt ? (Date.now() - createdAt) / 60_000 : 0;
        if (ageMinutes > 10) {
          return {
            status: 'FAILED',
            endpointUrl: `https://api.runpod.ai/v2/${providerDeploymentId}`,
            metadata: { ...data, error: 'Stuck initializing for >10 minutes — likely image pull failure. Check the Docker image name and tag.' },
          };
        }
      }
    }

    const statusMap: Record<string, ProviderStatus['status']> = {
      READY: 'ONLINE',
      INITIALIZING: 'DEPLOYING',
      UNHEALTHY: 'DEGRADED',
      OFFLINE: 'ONLINE',
      RUNNING: 'ONLINE',
      SCALING: 'DEPLOYING',
      PENDING: 'DEPLOYING',
      CREATING: 'DEPLOYING',
    };

    const mapped = statusMap[rawStatus] || statusMap[rawStatus.toUpperCase()];
    if (!mapped) {
      console.warn(`[RunPodAdapter.getStatus] Unknown RunPod status "${rawStatus}" for ${providerDeploymentId}, defaulting to DEPLOYING`);
    }
    return {
      status: mapped || 'DEPLOYING',
      endpointUrl: `https://api.runpod.ai/v2/${providerDeploymentId}`,
      metadata: { ...data, rawStatus },
    };
  }

  async destroy(providerDeploymentId: string, metadata?: Record<string, unknown>): Promise<DestroyResult> {
    const allSteps: DestroyStep[] = [];

    let templateId = metadata?.templateId as string | undefined;
    if (!templateId) {
      try {
        const detailRes = await authenticatedProviderFetch(this.slug, this.apiConfig, `/endpoints/${providerDeploymentId}`);
        if (detailRes.ok) {
          const detail = await detailRes.json();
          templateId = detail.templateId;
          allSteps.push({ resource: 'endpoint', resourceId: providerDeploymentId, action: 'RESOLVE_TEMPLATE', status: 'ok', detail: `templateId=${templateId}` });
        } else if (detailRes.status === 404) {
          allSteps.push({ resource: 'endpoint', resourceId: providerDeploymentId, action: 'RESOLVE_TEMPLATE', status: 'ok', detail: 'Endpoint already gone (404)' });
        } else {
          allSteps.push({ resource: 'endpoint', resourceId: providerDeploymentId, action: 'RESOLVE_TEMPLATE', status: 'failed', error: `GET returned ${detailRes.status}` });
        }
      } catch (err: any) {
        allSteps.push({ resource: 'endpoint', resourceId: providerDeploymentId, action: 'RESOLVE_TEMPLATE', status: 'failed', error: err.message });
      }
    } else {
      allSteps.push({ resource: 'endpoint', resourceId: providerDeploymentId, action: 'RESOLVE_TEMPLATE', status: 'ok', detail: `templateId=${templateId} (from metadata)` });
    }

    const endpointSteps = await this.deleteAndVerify('endpoint', providerDeploymentId, `/endpoints/${providerDeploymentId}`, 3);
    allSteps.push(...endpointSteps);

    const endpointClean = endpointSteps.some(s => s.action === 'VERIFY_DELETED' && s.status === 'ok')
      || endpointSteps.some(s => s.action === 'DELETE' && s.status === 'ok' && s.detail?.includes('404'));

    let templateClean = true;
    if (templateId) {
      const templateSteps = await this.deleteAndVerify('template', templateId, `/templates/${templateId}`, 3);
      allSteps.push(...templateSteps);
      templateClean = templateSteps.some(s => s.action === 'VERIFY_DELETED' && s.status === 'ok')
        || templateSteps.some(s => s.action === 'DELETE' && s.status === 'ok' && s.detail?.includes('404'));
    } else {
      allSteps.push({ resource: 'template', action: 'DELETE', status: 'skipped', detail: 'No templateId available' });
    }

    return { allClean: endpointClean && templateClean, steps: allSteps };
  }

  private async deleteAndVerify(
    label: string, resourceId: string, path: string, maxRetries: number,
  ): Promise<DestroyStep[]> {
    const steps: DestroyStep[] = [];
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const delRes = await authenticatedProviderFetch(this.slug, this.apiConfig, path, { method: 'DELETE' });
        if (delRes.status === 404) {
          steps.push({ resource: label, resourceId, action: 'DELETE', status: 'ok', detail: 'Already deleted (404)' });
          return steps;
        }
        if (delRes.ok) {
          steps.push({ resource: label, resourceId, action: 'DELETE', status: 'ok', detail: `Deleted (${delRes.status}) on attempt ${attempt + 1}` });
        } else {
          steps.push({ resource: label, resourceId, action: 'DELETE', status: 'failed', error: `${delRes.status}: ${await delRes.text().catch(() => 'unknown')}` });
        }
      } catch (err: any) {
        steps.push({ resource: label, resourceId, action: 'DELETE', status: 'failed', error: err.message });
      }

      await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));

      try {
        const verifyRes = await authenticatedProviderFetch(this.slug, this.apiConfig, path);
        if (!verifyRes.ok || verifyRes.status === 404) {
          steps.push({ resource: label, resourceId, action: 'VERIFY_DELETED', status: 'ok', detail: `Confirmed gone after attempt ${attempt + 1}` });
          return steps;
        }
        steps.push({ resource: label, resourceId, action: 'VERIFY_DELETED', status: 'failed', detail: `Still exists after attempt ${attempt + 1}` });
      } catch {
        steps.push({ resource: label, resourceId, action: 'VERIFY_DELETED', status: 'ok', detail: `Verification request failed (likely gone) after attempt ${attempt + 1}` });
        return steps;
      }
    }
    return steps;
  }

  async update(providerDeploymentId: string, config: UpdateConfig): Promise<ProviderDeployment> {
    const body: Record<string, unknown> = {};
    if (config.dockerImage) body.imageName = config.dockerImage;
    if (config.gpuModel) body.gpuTypeIds = [config.gpuModel];
    if (config.gpuCount) body.gpuCount = config.gpuCount;

    const res = await authenticatedProviderFetch(this.slug, this.apiConfig, `/endpoints/${providerDeploymentId}`, {
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
      const [healthRes, endpointRes] = await Promise.all([
        authenticatedProviderFetch(this.slug, this.apiConfig, `/endpoints/${providerDeploymentId}/health`),
        authenticatedProviderFetch(this.slug, this.apiConfig, `/endpoints/${providerDeploymentId}`),
      ]);
      const responseTimeMs = Date.now() - start;

      if (!healthRes.ok && !endpointRes.ok) {
        return { healthy: false, status: 'RED', responseTimeMs, statusCode: healthRes.status };
      }

      const healthData = healthRes.ok ? await healthRes.json() : {};
      const endpointData = endpointRes.ok ? await endpointRes.json() : {};

      const workers = healthData.workers || {};
      const endpointStatus = endpointData.status || healthData.status || 'UNKNOWN';
      const workersMin = endpointData.workersMin ?? 0;

      const isServerless = workersMin === 0;
      const isReady = endpointStatus === 'READY' || workers.running > 0;
      const isIdleServerless = isServerless && (endpointStatus === 'OFFLINE' || endpointStatus === 'INITIALIZING');
      const healthy = isReady || isIdleServerless;

      let status: 'GREEN' | 'ORANGE' | 'RED';
      if (isIdleServerless && !isReady) {
        status = 'ORANGE';
      } else if (healthy) {
        status = responseTimeMs > 5000 ? 'ORANGE' : 'GREEN';
      } else {
        status = 'RED';
      }

      return {
        healthy,
        status,
        responseTimeMs,
        statusCode: healthRes.status,
        details: {
          endpointStatus,
          isServerless,
          workers: {
            running: workers.running ?? 0,
            idle: workers.idle ?? 0,
            total: workers.total ?? endpointData.workersTotal ?? 0,
            min: workersMin,
            max: endpointData.workersMax ?? 0,
          },
          jobs: {
            completed: healthData.jobs?.completed ?? 0,
            inQueue: healthData.jobs?.inQueue ?? 0,
            inProgress: healthData.jobs?.inProgress ?? 0,
          },
          note: isIdleServerless && !isReady
            ? 'Serverless endpoint scaled to zero — workers spin up on demand'
            : undefined,
        },
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
