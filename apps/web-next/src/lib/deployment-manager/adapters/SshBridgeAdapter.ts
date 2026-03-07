import type { IProviderAdapter } from './IProviderAdapter';
import type { ProviderApiConfig, GpuOption, DeployConfig, UpdateConfig, ProviderDeployment, ProviderStatus, HealthResult } from '../types';
import { authenticatedProviderFetch } from '../provider-fetch';

export class SshBridgeAdapter implements IProviderAdapter {
  readonly slug = 'ssh-bridge';
  readonly displayName = 'SSH Bridge (Bare-Metal / VM)';
  readonly mode = 'ssh-bridge' as const;
  readonly icon = '🖥️';
  readonly description = 'Deploy Docker containers directly to GPU machines via SSH. Requires Docker + NVIDIA runtime pre-installed.';
  readonly authMethod = 'ssh-key';
  readonly apiConfig: ProviderApiConfig = {
    upstreamBaseUrl: 'http://localhost:2222',
    authType: 'none',
    secretNames: ['ssh-key'],
    healthCheckPath: null,
  };

  private fetch(path: string, options: RequestInit = {}) {
    return authenticatedProviderFetch(this.slug, this.apiConfig, path, options);
  }

  async getGpuOptions(): Promise<GpuOption[]> {
    return [
      { id: 'NVIDIA A100 80GB', name: 'NVIDIA A100 80GB', vramGb: 80, available: true },
      { id: 'NVIDIA A100 40GB', name: 'NVIDIA A100 40GB', vramGb: 40, available: true },
      { id: 'NVIDIA H100 80GB', name: 'NVIDIA H100 80GB', vramGb: 80, available: true },
      { id: 'NVIDIA H100 SXM', name: 'NVIDIA H100 SXM', vramGb: 80, available: true },
      { id: 'NVIDIA A40', name: 'NVIDIA A40', vramGb: 48, available: true },
      { id: 'NVIDIA L40S', name: 'NVIDIA L40S', vramGb: 48, available: true },
      { id: 'NVIDIA RTX 4090', name: 'NVIDIA RTX 4090', vramGb: 24, available: true },
      { id: 'NVIDIA RTX A6000', name: 'NVIDIA RTX A6000', vramGb: 48, available: true },
      { id: 'NVIDIA T4', name: 'NVIDIA T4', vramGb: 16, available: true },
      { id: 'custom', name: 'Custom (specify manually)', vramGb: 0, available: true },
    ];
  }

  async deploy(config: DeployConfig): Promise<ProviderDeployment> {
    if (!config.sshHost || !config.sshUsername) {
      throw new Error('SSH host and username are required for SSH Bridge deployments');
    }

    const connectRes = await this.fetch('/connect', {
      method: 'POST',
      body: JSON.stringify({ host: config.sshHost, port: config.sshPort || 22, username: config.sshUsername }),
    });
    if (!connectRes.ok) throw new Error(`SSH connection failed: ${await connectRes.text()}`);

    const containerName = config.containerName || `naap-${config.artifactType}-${Date.now()}`;
    const healthPort = config.artifactType === 'scope' ? 8188 : 8080;

    const deployScript = [
      '#!/bin/bash', 'set -euo pipefail', '',
      'echo "=== Preflight checks ==="',
      'nvidia-smi --query-gpu=name,memory.total,memory.free --format=csv,noheader',
      'docker info | grep -i runtime || true', '',
      `echo "=== Pulling ${config.dockerImage} ==="`, `docker pull ${config.dockerImage}`, '',
      `echo "=== Stopping old container ${containerName} ==="`,
      `docker stop ${containerName} 2>/dev/null || true`, `docker rm ${containerName} 2>/dev/null || true`, '',
      `echo "=== Starting ${containerName} ==="`,
      `docker run -d --name ${containerName} \\`, '  --gpus all --restart unless-stopped \\',
      `  -p ${healthPort}:${healthPort} \\`, `  ${config.dockerImage}`, '',
      `echo "=== Waiting for health endpoint ==="`,
      'for i in $(seq 1 30); do',
      `  if curl -sf http://localhost:${healthPort}/health > /dev/null 2>&1; then`,
      '    echo "Healthy after $((i * 10))s"', '    exit 0', '  fi',
      '  echo "Waiting... ($i/30)"', '  sleep 10', 'done',
      `echo "=== FAILED: Container not healthy after 300s ==="`, `docker logs ${containerName} --tail 50`, 'exit 1',
    ].join('\n');

    const scriptRes = await this.fetch('/exec/script', {
      method: 'POST',
      body: JSON.stringify({ host: config.sshHost, port: config.sshPort || 22, username: config.sshUsername, script: deployScript, timeout: 1800000, workingDirectory: '/tmp' }),
    });
    if (!scriptRes.ok) throw new Error(`SSH deploy script submission failed: ${await scriptRes.text()}`);

    const scriptData = await scriptRes.json();
    const jobId = scriptData.data?.jobId || scriptData.jobId;

    return {
      providerDeploymentId: `${config.sshHost}:${containerName}:${jobId}`,
      endpointUrl: `http://${config.sshHost}:${healthPort}`,
      status: 'DEPLOYING',
      metadata: { jobId, containerName, sshHost: config.sshHost },
    };
  }

  async getStatus(providerDeploymentId: string): Promise<ProviderStatus> {
    const [host, , jobId] = providerDeploymentId.split(':');
    if (jobId) {
      try {
        const res = await this.fetch(`/jobs/${jobId}`);
        if (res.ok) {
          const data = await res.json();
          const jobStatus = data.data?.status || data.status;
          if (jobStatus === 'completed') {
            const exitCode = data.data?.exitCode ?? data.exitCode;
            return { status: exitCode === 0 ? 'ONLINE' : 'FAILED', endpointUrl: `http://${host}:8080`, metadata: data.data || data };
          }
          if (['failed', 'timeout', 'cancelled'].includes(jobStatus)) return { status: 'FAILED', metadata: data.data || data };
          return { status: 'DEPLOYING', metadata: data.data || data };
        }
      } catch { /* fall through */ }
    }
    return { status: 'ONLINE', endpointUrl: `http://${host}:8080` };
  }

  async destroy(providerDeploymentId: string): Promise<void> {
    const [host, containerName] = providerDeploymentId.split(':');
    const res = await this.fetch('/exec', {
      method: 'POST',
      body: JSON.stringify({ host, port: 22, username: 'deploy', command: `docker stop ${containerName} 2>/dev/null; docker rm ${containerName} 2>/dev/null; echo "removed"`, timeout: 30000 }),
    });
    if (!res.ok && res.status !== 404) throw new Error(`SSH destroy failed: ${await res.text()}`);
  }

  async update(providerDeploymentId: string, config: UpdateConfig): Promise<ProviderDeployment> {
    const [host, containerName] = providerDeploymentId.split(':');
    if (!config.dockerImage) throw new Error('dockerImage is required for SSH Bridge updates');

    const updateScript = [
      '#!/bin/bash', 'set -euo pipefail',
      `echo "=== Pulling ${config.dockerImage} ==="`, `docker pull ${config.dockerImage}`,
      `echo "=== Stopping ${containerName} ==="`,
      `docker stop ${containerName} 2>/dev/null || true`, `docker rm ${containerName} 2>/dev/null || true`,
      `echo "=== Starting updated ${containerName} ==="`,
      `docker run -d --name ${containerName} \\`, '  --gpus all --restart unless-stopped \\',
      '  -p 8080:8080 \\', `  ${config.dockerImage}`,
      'for i in $(seq 1 30); do',
      '  if curl -sf http://localhost:8080/health > /dev/null 2>&1; then',
      '    echo "Updated and healthy after $((i * 10))s"', '    exit 0', '  fi', '  sleep 10', 'done',
      'echo "Update health check failed"', 'exit 1',
    ].join('\n');

    const res = await this.fetch('/exec/script', {
      method: 'POST',
      body: JSON.stringify({ host, port: 22, username: 'deploy', script: updateScript, timeout: 900000 }),
    });
    if (!res.ok) throw new Error(`SSH update failed: ${await res.text()}`);
    const data = await res.json();
    const jobId = data.data?.jobId || data.jobId;
    return { providerDeploymentId: `${host}:${containerName}:${jobId}`, endpointUrl: `http://${host}:8080`, status: 'UPDATING', metadata: { jobId } };
  }

  async healthCheck(_providerDeploymentId: string, endpointUrl?: string): Promise<HealthResult> {
    if (!endpointUrl) return { healthy: false, status: 'RED' };
    const url = new URL(endpointUrl);
    const host = url.hostname;
    const port = parseInt(url.port || '8080', 10);

    try {
      const start = Date.now();
      const res = await this.fetch('/exec', {
        method: 'POST',
        body: JSON.stringify({ host, port: 22, username: 'deploy', command: `curl -sf -o /dev/null -w "%{http_code}" http://localhost:${port}/health`, timeout: 15000 }),
      });
      const responseTimeMs = Date.now() - start;
      if (!res.ok) return { healthy: false, status: 'RED', responseTimeMs };
      const data = await res.json();
      const exitCode = data.data?.exitCode ?? data.exitCode;
      const stdout = (data.data?.stdout || data.stdout || '').trim();
      const statusCode = parseInt(stdout, 10) || 0;
      const healthy = exitCode === 0 && statusCode >= 200 && statusCode < 300;
      return { healthy, status: healthy ? (responseTimeMs > 5000 ? 'ORANGE' : 'GREEN') : 'RED', responseTimeMs, statusCode, details: data.data || data };
    } catch { return { healthy: false, status: 'RED' }; }
  }
}
