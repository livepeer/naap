import type { IProviderAdapter, DestroyResult, DestroyStep } from './IProviderAdapter';
import type { ProviderApiConfig, GpuOption, DeployConfig, UpdateConfig, ProviderDeployment, ProviderStatus, HealthResult } from '../types';
import { authenticatedProviderFetch } from '../provider-fetch';

// RunPod has two APIs:
// - Management API: https://rest.runpod.io/v1  (CRUD for templates, endpoints)
// - Serverless API: https://api.runpod.ai/v2   (health, status, run jobs)
const RUNPOD_SERVERLESS_BASE = 'https://api.runpod.ai/v2';

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

  private readonly serverlessApiConfig: ProviderApiConfig = {
    upstreamBaseUrl: RUNPOD_SERVERLESS_BASE,
    authType: 'bearer',
    authHeaderTemplate: 'Bearer {{secret}}',
    secretNames: ['api-key'],
    healthCheckPath: '',
  };

  private fetch(path: string, options: RequestInit = {}) {
    return authenticatedProviderFetch(this.slug, this.apiConfig, path, options);
  }

  private fetchServerless(path: string, options: RequestInit = {}) {
    return authenticatedProviderFetch(this.slug, this.serverlessApiConfig, path, options);
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
    const [healthRes, configRes] = await Promise.allSettled([
      this.fetchServerless(`/${providerDeploymentId}/health`),
      this.fetch(`/endpoints/${providerDeploymentId}`),
    ]);

    const healthOk = healthRes.status === 'fulfilled' && healthRes.value.ok;
    const configOk = configRes.status === 'fulfilled' && configRes.value.ok;

    if (!healthOk && !configOk) {
      const httpStatus = healthRes.status === 'fulfilled' ? healthRes.value.status : 0;
      const body = healthRes.status === 'fulfilled' ? await healthRes.value.text().catch(() => '') : '';
      if (httpStatus === 410) {
        return { status: 'FAILED', metadata: { error: 'Endpoint has been deleted (410 Gone)', body } };
      }
      return { status: 'DEPLOYING', metadata: { error: `RunPod API returned ${httpStatus} (transient)`, body, httpStatus } };
    }

    const healthData = healthOk ? await (healthRes as PromiseFulfilledResult<Response>).value.json() : {};
    const configData = configOk ? await (configRes as PromiseFulfilledResult<Response>).value.json() : {};

    const workers = healthData.workers || {};
    const workersMin = configData.workersMin ?? 0;
    const isServerless = workersMin === 0;

    const hasReady = (workers.ready ?? 0) > 0;
    const hasIdle = (workers.idle ?? 0) > 0;
    const hasRunning = (workers.running ?? 0) > 0;
    const hasInitializing = (workers.initializing ?? 0) > 0;
    const hasUnhealthy = (workers.unhealthy ?? 0) > 0;
    const totalWorkers = (workers.ready ?? 0) + (workers.idle ?? 0) + (workers.running ?? 0) + (workers.initializing ?? 0);

    let status: ProviderStatus['status'];
    if (hasReady || hasIdle || hasRunning) {
      status = hasUnhealthy ? 'DEGRADED' : 'ONLINE';
    } else if (isServerless && totalWorkers === 0 && !hasInitializing) {
      status = 'ONLINE';
    } else if (hasInitializing) {
      const createdAt = configData.createdAt ? new Date(configData.createdAt).getTime() : 0;
      const ageMinutes = createdAt ? (Date.now() - createdAt) / 60_000 : 0;
      status = ageMinutes > 10 ? 'FAILED' : 'DEPLOYING';
    } else {
      status = 'DEPLOYING';
    }

    return {
      status,
      endpointUrl: `https://api.runpod.ai/v2/${providerDeploymentId}`,
      metadata: { ...configData, workers, jobs: healthData.jobs },
    };
  }

  async destroy(providerDeploymentId: string, metadata?: Record<string, unknown>): Promise<DestroyResult> {
    const steps: DestroyStep[] = [];

    // Delete endpoint with retry + verification
    const endpointSteps = await this.deleteWithRetry(`/endpoints/${providerDeploymentId}`, 'endpoint', providerDeploymentId);
    steps.push(...endpointSteps);

    // Delete template if stored in metadata
    const templateId = (metadata as any)?.templateId;
    if (templateId) {
      const templateSteps = await this.deleteWithRetry(`/templates/${templateId}`, 'template', templateId);
      steps.push(...templateSteps);
    }

    const allClean = steps.every((s) => s.status === 'ok');
    return { allClean, steps };
  }

  private async deleteWithRetry(path: string, label: string, resourceId: string, maxRetries = 2): Promise<DestroyStep[]> {
    const steps: DestroyStep[] = [];
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const res = await this.fetch(path, { method: 'DELETE' });
        if (res.status === 404) {
          steps.push({ resource: label, resourceId, action: 'DELETE', status: 'ok', detail: 'Already deleted (404)' });
          return steps;
        }
        if (res.ok) {
          steps.push({ resource: label, resourceId, action: 'DELETE', status: 'ok', detail: `Deleted on attempt ${attempt + 1}` });
        } else {
          steps.push({ resource: label, resourceId, action: 'DELETE', status: 'failed', error: `${res.status}: ${await res.text().catch(() => 'unknown')}` });
        }
      } catch (err: any) {
        steps.push({ resource: label, resourceId, action: 'DELETE', status: 'failed', error: err.message });
      }

      await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));

      try {
        const verifyRes = await this.fetch(path);
        if (!verifyRes.ok || verifyRes.status === 404) {
          steps.push({ resource: label, resourceId, action: 'VERIFY_DELETED', status: 'ok', detail: `Confirmed gone after attempt ${attempt + 1}` });
          return steps;
        }
        steps.push({ resource: label, resourceId, action: 'VERIFY_DELETED', status: 'failed', detail: `Still exists after attempt ${attempt + 1}` });
      } catch {
        steps.push({ resource: label, resourceId, action: 'VERIFY_DELETED', status: 'ok', detail: 'Verification request failed (likely gone)' });
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
      const [healthRes, configRes] = await Promise.all([
        this.fetchServerless(`/${providerDeploymentId}/health`),
        this.fetch(`/endpoints/${providerDeploymentId}`),
      ]);
      const responseTimeMs = Date.now() - start;

      if (!healthRes.ok && !configRes.ok) {
        return { healthy: false, status: 'RED', responseTimeMs, statusCode: healthRes.status };
      }

      const healthData = healthRes.ok ? await healthRes.json() : {};
      const configData = configRes.ok ? await configRes.json() : {};

      const workers = healthData.workers || {};
      const workersMin = configData.workersMin ?? 0;
      const isServerless = workersMin === 0;

      const hasReady = (workers.ready ?? 0) > 0;
      const hasIdle = (workers.idle ?? 0) > 0;
      const hasRunning = (workers.running ?? 0) > 0;
      const isScaledToZero = isServerless && !hasReady && !hasIdle && !hasRunning;
      const healthy = hasReady || hasIdle || hasRunning || isScaledToZero;

      let status: 'GREEN' | 'ORANGE' | 'RED';
      if (isScaledToZero) {
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
          isServerless,
          workers: {
            ready: workers.ready ?? 0,
            idle: workers.idle ?? 0,
            running: workers.running ?? 0,
            initializing: workers.initializing ?? 0,
            unhealthy: workers.unhealthy ?? 0,
            min: workersMin,
            max: configData.workersMax ?? 0,
          },
          jobs: {
            completed: healthData.jobs?.completed ?? 0,
            failed: healthData.jobs?.failed ?? 0,
            inQueue: healthData.jobs?.inQueue ?? 0,
            inProgress: healthData.jobs?.inProgress ?? 0,
          },
          note: isScaledToZero
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
