import type { DeploymentStatus, DeployConfig, UpdateConfig, HealthStatus } from '../types/index.js';
import type { ProviderAdapterRegistry } from './ProviderAdapterRegistry.js';
import type { AuditService } from './AuditService.js';

export interface DeploymentRecord {
  id: string;
  name: string;
  teamId?: string;
  ownerUserId: string;
  providerSlug: string;
  providerMode: string;
  providerConfig?: Record<string, unknown>;
  connectorId?: string;
  gpuModel: string;
  gpuVramGb: number;
  gpuCount: number;
  cudaVersion?: string;
  artifactType: string;
  artifactVersion: string;
  dockerImage: string;
  artifactConfig?: Record<string, unknown>;
  status: DeploymentStatus;
  healthStatus: HealthStatus;
  providerDeploymentId?: string;
  endpointUrl?: string;
  sshHost?: string;
  sshPort?: number;
  sshUsername?: string;
  containerName?: string;
  latestAvailableVersion?: string;
  hasUpdate: boolean;
  createdAt: Date;
  updatedAt: Date;
  lastHealthCheck?: Date;
  deployedAt?: Date;
}

interface StatusLogEntry {
  id: string;
  deploymentId: string;
  fromStatus?: DeploymentStatus;
  toStatus: DeploymentStatus;
  reason?: string;
  initiatedBy?: string;
  metadata?: Record<string, unknown>;
  createdAt: Date;
}

const VALID_TRANSITIONS: Record<DeploymentStatus, DeploymentStatus[]> = {
  PENDING: ['PROVISIONING', 'DESTROYING'],
  PROVISIONING: ['DEPLOYING', 'FAILED'],
  DEPLOYING: ['VALIDATING', 'FAILED'],
  VALIDATING: ['ONLINE', 'FAILED'],
  ONLINE: ['DEGRADED', 'OFFLINE', 'UPDATING', 'DESTROYING'],
  DEGRADED: ['ONLINE', 'OFFLINE', 'DESTROYING'],
  OFFLINE: ['ONLINE', 'DESTROYING'],
  UPDATING: ['VALIDATING', 'FAILED'],
  FAILED: ['PROVISIONING', 'DESTROYING'],
  DESTROYING: ['DESTROYED'],
  DESTROYED: [],
};

export class DeploymentOrchestrator {
  private deployments = new Map<string, DeploymentRecord>();
  private statusLogs: StatusLogEntry[] = [];

  constructor(
    private registry: ProviderAdapterRegistry,
    private audit: AuditService,
  ) {}

  async create(config: DeployConfig, userId: string, teamId?: string): Promise<DeploymentRecord> {
    const adapter = this.registry.get(config.providerSlug);

    const id = crypto.randomUUID();
    const now = new Date();

    const record: DeploymentRecord = {
      id,
      name: config.name,
      teamId,
      ownerUserId: userId,
      providerSlug: config.providerSlug,
      providerMode: adapter.mode,
      gpuModel: config.gpuModel,
      gpuVramGb: config.gpuVramGb,
      gpuCount: config.gpuCount,
      cudaVersion: config.cudaVersion,
      artifactType: config.artifactType,
      artifactVersion: config.artifactVersion,
      dockerImage: config.dockerImage,
      artifactConfig: config.artifactConfig,
      status: 'PENDING',
      healthStatus: 'UNKNOWN',
      sshHost: config.sshHost,
      sshPort: config.sshPort,
      sshUsername: config.sshUsername,
      containerName: config.containerName,
      hasUpdate: false,
      createdAt: now,
      updatedAt: now,
    };

    this.deployments.set(id, record);
    this.recordTransition(id, undefined, 'PENDING', 'Created', userId);

    await this.audit.log({
      deploymentId: id,
      action: 'CREATE',
      resource: 'deployment',
      resourceId: id,
      userId,
      details: { name: config.name, provider: config.providerSlug, artifact: config.artifactType },
      status: 'success',
    });

    return record;
  }

  async get(id: string): Promise<DeploymentRecord | undefined> {
    return this.deployments.get(id);
  }

  async list(filters?: {
    ownerUserId?: string;
    teamId?: string;
    status?: DeploymentStatus;
    providerSlug?: string;
  }): Promise<DeploymentRecord[]> {
    let results = Array.from(this.deployments.values());

    if (filters?.ownerUserId) {
      results = results.filter((d) => d.ownerUserId === filters.ownerUserId);
    }
    if (filters?.teamId) {
      results = results.filter((d) => d.teamId === filters.teamId);
    }
    if (filters?.status) {
      results = results.filter((d) => d.status === filters.status);
    }
    if (filters?.providerSlug) {
      results = results.filter((d) => d.providerSlug === filters.providerSlug);
    }

    return results.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async deploy(id: string, userId: string): Promise<DeploymentRecord> {
    const record = this.getOrThrow(id);
    this.assertTransition(record.status, 'PROVISIONING');

    const adapter = this.registry.get(record.providerSlug);
    this.transition(record, 'PROVISIONING', 'Deploy initiated', userId);

    try {
      const result = await adapter.deploy({
        name: record.name,
        providerSlug: record.providerSlug,
        gpuModel: record.gpuModel,
        gpuVramGb: record.gpuVramGb,
        gpuCount: record.gpuCount,
        cudaVersion: record.cudaVersion,
        artifactType: record.artifactType as 'ai-runner' | 'scope',
        artifactVersion: record.artifactVersion,
        dockerImage: record.dockerImage,
        artifactConfig: record.artifactConfig,
        sshHost: record.sshHost,
        sshPort: record.sshPort,
        sshUsername: record.sshUsername,
        containerName: record.containerName,
      });

      record.providerDeploymentId = result.providerDeploymentId;
      record.endpointUrl = result.endpointUrl;
      record.deployedAt = new Date();
      this.transition(record, 'DEPLOYING', 'Provider accepted deployment', userId);

      await this.audit.log({
        deploymentId: id,
        action: 'DEPLOY',
        resource: 'deployment',
        resourceId: id,
        userId,
        details: { providerDeploymentId: result.providerDeploymentId, endpointUrl: result.endpointUrl },
        status: 'success',
      });

      return record;
    } catch (err: any) {
      this.transition(record, 'FAILED', err.message, userId);
      await this.audit.log({
        deploymentId: id,
        action: 'DEPLOY',
        resource: 'deployment',
        resourceId: id,
        userId,
        status: 'failure',
        errorMsg: err.message,
      });
      throw err;
    }
  }

  async destroy(id: string, userId: string): Promise<DeploymentRecord> {
    const record = this.getOrThrow(id);
    this.assertTransition(record.status, 'DESTROYING');

    const adapter = this.registry.get(record.providerSlug);
    this.transition(record, 'DESTROYING', 'Destroy initiated', userId);

    try {
      if (record.providerDeploymentId) {
        await adapter.destroy(record.providerDeploymentId);
      }
      this.transition(record, 'DESTROYED', 'Destroyed', userId);

      await this.audit.log({
        deploymentId: id,
        action: 'DESTROY',
        resource: 'deployment',
        resourceId: id,
        userId,
        status: 'success',
      });

      return record;
    } catch (err: any) {
      this.transition(record, 'FAILED', err.message, userId);
      await this.audit.log({
        deploymentId: id,
        action: 'DESTROY',
        resource: 'deployment',
        resourceId: id,
        userId,
        status: 'failure',
        errorMsg: err.message,
      });
      throw err;
    }
  }

  async updateDeployment(id: string, config: UpdateConfig, userId: string): Promise<DeploymentRecord> {
    const record = this.getOrThrow(id);
    this.assertTransition(record.status, 'UPDATING');

    const adapter = this.registry.get(record.providerSlug);
    this.transition(record, 'UPDATING', 'Update initiated', userId);

    try {
      if (record.providerDeploymentId) {
        const result = await adapter.update(record.providerDeploymentId, config);
        record.providerDeploymentId = result.providerDeploymentId;
        if (result.endpointUrl) record.endpointUrl = result.endpointUrl;
      }
      if (config.artifactVersion) record.artifactVersion = config.artifactVersion;
      if (config.dockerImage) record.dockerImage = config.dockerImage;
      if (config.gpuModel) record.gpuModel = config.gpuModel;
      if (config.gpuVramGb) record.gpuVramGb = config.gpuVramGb;
      if (config.gpuCount) record.gpuCount = config.gpuCount;

      this.transition(record, 'VALIDATING', 'Update deployed, validating', userId);

      await this.audit.log({
        deploymentId: id,
        action: 'UPDATE',
        resource: 'deployment',
        resourceId: id,
        userId,
        details: config as Record<string, unknown>,
        status: 'success',
      });

      return record;
    } catch (err: any) {
      this.transition(record, 'FAILED', err.message, userId);
      await this.audit.log({
        deploymentId: id,
        action: 'UPDATE',
        resource: 'deployment',
        resourceId: id,
        userId,
        status: 'failure',
        errorMsg: err.message,
      });
      throw err;
    }
  }

  async validate(id: string, userId: string): Promise<DeploymentRecord> {
    const record = this.getOrThrow(id);
    if (record.status !== 'VALIDATING' && record.status !== 'DEPLOYING') {
      throw new Error(`Cannot validate deployment in status ${record.status}`);
    }

    const adapter = this.registry.get(record.providerSlug);

    try {
      const health = await adapter.healthCheck(
        record.providerDeploymentId || '',
        record.endpointUrl || undefined,
      );

      if (health.healthy) {
        this.transition(record, 'ONLINE', 'Validation passed', userId);
        record.healthStatus = 'GREEN';
        record.lastHealthCheck = new Date();
      } else {
        this.transition(record, 'FAILED', 'Validation failed: health check returned unhealthy', userId);
        record.healthStatus = 'RED';
      }

      return record;
    } catch (err: any) {
      this.transition(record, 'FAILED', `Validation error: ${err.message}`, userId);
      throw err;
    }
  }

  async deployAndValidate(id: string, userId: string, maxRetries = 0): Promise<DeploymentRecord> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const record = this.getOrThrow(id);

        if (record.status === 'FAILED' && attempt > 0) {
          this.assertTransition(record.status, 'PROVISIONING');
          this.transition(record, 'PROVISIONING', `Retry attempt ${attempt}/${maxRetries}`, userId);
          // Re-deploy
          const adapter = this.registry.get(record.providerSlug);
          const result = await adapter.deploy({
            name: record.name,
            providerSlug: record.providerSlug,
            gpuModel: record.gpuModel,
            gpuVramGb: record.gpuVramGb,
            gpuCount: record.gpuCount,
            cudaVersion: record.cudaVersion,
            artifactType: record.artifactType as 'ai-runner' | 'scope',
            artifactVersion: record.artifactVersion,
            dockerImage: record.dockerImage,
            artifactConfig: record.artifactConfig,
            sshHost: record.sshHost,
            sshPort: record.sshPort,
            sshUsername: record.sshUsername,
            containerName: record.containerName,
          });
          record.providerDeploymentId = result.providerDeploymentId;
          record.endpointUrl = result.endpointUrl;
          this.transition(record, 'DEPLOYING', 'Provider accepted retry', userId);
        } else if (record.status === 'PENDING') {
          await this.deploy(id, userId);
        }

        // Poll for status until deployed, then validate
        const deployed = this.getOrThrow(id);
        if (deployed.status === 'DEPLOYING' || deployed.status === 'VALIDATING') {
          // For SSH Bridge, poll the job status
          if (deployed.providerMode === 'ssh-bridge' && deployed.providerDeploymentId) {
            const adapter = this.registry.get(deployed.providerSlug);
            const pollResult = await this.pollUntilReady(adapter, deployed, userId);
            if (pollResult.status === 'FAILED') {
              lastError = new Error('Deployment failed during provisioning');
              continue;
            }
          }
          return await this.validate(id, userId);
        }

        return deployed;
      } catch (err: any) {
        lastError = err;
        if (attempt < maxRetries) {
          await new Promise((r) => setTimeout(r, 5000));
        }
      }
    }

    throw lastError || new Error('Deploy and validate failed');
  }

  async retry(id: string, userId: string): Promise<DeploymentRecord> {
    const record = this.getOrThrow(id);
    if (record.status !== 'FAILED') {
      throw new Error(`Can only retry FAILED deployments, current status: ${record.status}`);
    }
    this.assertTransition(record.status, 'PROVISIONING');
    return this.deployAndValidate(id, userId, 0);
  }

  private async pollUntilReady(
    adapter: import('../adapters/IProviderAdapter.js').IProviderAdapter,
    record: DeploymentRecord,
    userId: string,
  ): Promise<DeploymentRecord> {
    const maxAttempts = 60;
    for (let i = 0; i < maxAttempts; i++) {
      await new Promise((r) => setTimeout(r, 10_000));
      try {
        const status = await adapter.getStatus(record.providerDeploymentId!);
        if (status.status === 'ONLINE') {
          if (status.endpointUrl) record.endpointUrl = status.endpointUrl;
          this.transition(record, 'VALIDATING', 'Provider reports ready', userId);
          return record;
        }
        if (status.status === 'FAILED') {
          this.transition(record, 'FAILED', 'Provider reports failure', userId);
          return record;
        }
      } catch {
        // Continue polling on transient errors
      }
    }
    this.transition(record, 'FAILED', 'Deployment timed out during polling', userId);
    return record;
  }

  async remove(id: string): Promise<boolean> {
    return this.deployments.delete(id);
  }

  getStatusHistory(deploymentId: string): StatusLogEntry[] {
    return this.statusLogs
      .filter((l) => l.deploymentId === deploymentId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  updateHealthStatus(id: string, healthStatus: HealthStatus): void {
    const record = this.deployments.get(id);
    if (!record) return;

    record.healthStatus = healthStatus;
    record.lastHealthCheck = new Date();
    record.updatedAt = new Date();

    if (record.status === 'ONLINE' && healthStatus === 'ORANGE') {
      this.transition(record, 'DEGRADED', 'Health degraded', 'system');
    } else if (record.status === 'ONLINE' && healthStatus === 'RED') {
      this.transition(record, 'OFFLINE', 'Health check failed', 'system');
    } else if ((record.status === 'DEGRADED' || record.status === 'OFFLINE') && healthStatus === 'GREEN') {
      this.transition(record, 'ONLINE', 'Health recovered', 'system');
    }
  }

  private getOrThrow(id: string): DeploymentRecord {
    const record = this.deployments.get(id);
    if (!record) throw new Error(`Deployment not found: ${id}`);
    return record;
  }

  private assertTransition(from: DeploymentStatus, to: DeploymentStatus): void {
    const allowed = VALID_TRANSITIONS[from];
    if (!allowed || !allowed.includes(to)) {
      throw new Error(`Invalid state transition: ${from} -> ${to}`);
    }
  }

  private transition(
    record: DeploymentRecord,
    to: DeploymentStatus,
    reason: string,
    initiatedBy: string,
  ): void {
    const from = record.status;
    record.status = to;
    record.updatedAt = new Date();
    this.recordTransition(record.id, from, to, reason, initiatedBy);
  }

  private recordTransition(
    deploymentId: string,
    from: DeploymentStatus | undefined,
    to: DeploymentStatus,
    reason: string,
    initiatedBy: string,
  ): void {
    this.statusLogs.push({
      id: crypto.randomUUID(),
      deploymentId,
      fromStatus: from,
      toStatus: to,
      reason,
      initiatedBy,
      createdAt: new Date(),
    });
  }
}
