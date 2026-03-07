import { prisma } from '@/lib/db';
import type {
  DeploymentStatus,
  DeployConfig,
  UpdateConfig,
  HealthStatus,
  DeploymentRecord,
  StatusLogEntry,
  DeploymentFilters,
} from '../types';
import type { ProviderAdapterRegistry } from './ProviderAdapterRegistry';
import type { AuditService } from './AuditService';
import { setCurrentUserId } from '../provider-fetch';

const VALID_TRANSITIONS: Record<DeploymentStatus, DeploymentStatus[]> = {
  PENDING: ['PROVISIONING', 'DESTROYING'],
  PROVISIONING: ['DEPLOYING', 'FAILED', 'DESTROYING'],
  DEPLOYING: ['VALIDATING', 'ONLINE', 'FAILED', 'DESTROYING'],
  VALIDATING: ['ONLINE', 'FAILED', 'DESTROYING'],
  ONLINE: ['DEGRADED', 'OFFLINE', 'UPDATING', 'DESTROYING'],
  DEGRADED: ['ONLINE', 'OFFLINE', 'DESTROYING'],
  OFFLINE: ['ONLINE', 'DESTROYING'],
  UPDATING: ['VALIDATING', 'FAILED', 'DESTROYING'],
  FAILED: ['PROVISIONING', 'DESTROYING'],
  DESTROYING: ['DESTROYED', 'FAILED'],
  DESTROYED: [],
};

function toRecord(row: any): DeploymentRecord {
  return {
    id: row.id,
    name: row.name,
    teamId: row.teamId ?? undefined,
    ownerUserId: row.ownerUserId,
    providerSlug: row.providerSlug,
    providerMode: row.providerMode,
    providerConfig: (row.providerConfig as Record<string, unknown>) ?? undefined,
    connectorId: row.connectorId ?? undefined,
    gpuModel: row.gpuModel,
    gpuVramGb: row.gpuVramGb,
    gpuCount: row.gpuCount,
    cudaVersion: row.cudaVersion ?? undefined,
    artifactType: row.artifactType,
    artifactVersion: row.artifactVersion,
    dockerImage: row.dockerImage,
    artifactConfig: (row.artifactConfig as Record<string, unknown>) ?? undefined,
    status: row.status as DeploymentStatus,
    healthStatus: (row.healthStatus as HealthStatus) || 'UNKNOWN',
    providerDeploymentId: row.providerDeploymentId ?? undefined,
    endpointUrl: row.endpointUrl ?? undefined,
    sshHost: row.sshHost ?? undefined,
    sshPort: row.sshPort ?? undefined,
    sshUsername: row.sshUsername ?? undefined,
    containerName: row.containerName ?? undefined,
    latestAvailableVersion: row.latestAvailableVersion ?? undefined,
    hasUpdate: row.hasUpdate ?? false,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    lastHealthCheck: row.lastHealthCheck ?? undefined,
    deployedAt: row.deployedAt ?? undefined,
    statusMessage: row.statusMessage ?? undefined,
  };
}

export class DeploymentOrchestrator {
  constructor(
    private registry: ProviderAdapterRegistry,
    private audit: AuditService,
  ) {}

  async create(config: DeployConfig, userId: string, teamId?: string): Promise<DeploymentRecord> {
    const adapter = this.registry.get(config.providerSlug);

    const row = await prisma.dmDeployment.create({
      data: {
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
        artifactConfig: config.artifactConfig as any,
        status: 'PENDING',
        healthStatus: 'UNKNOWN',
        sshHost: config.sshHost,
        sshPort: config.sshPort,
        sshUsername: config.sshUsername,
        containerName: config.containerName,
      },
    });

    await this.recordTransition(row.id, undefined, 'PENDING', 'Created', userId);
    await this.audit.log({
      deploymentId: row.id,
      action: 'CREATE',
      resource: 'deployment',
      resourceId: row.id,
      userId,
      details: { name: config.name, provider: config.providerSlug, artifact: config.artifactType },
      status: 'success',
    });

    return toRecord(row);
  }

  async get(id: string): Promise<DeploymentRecord | undefined> {
    const row = await prisma.dmDeployment.findUnique({ where: { id } });
    return row ? toRecord(row) : undefined;
  }

  async list(filters?: DeploymentFilters): Promise<DeploymentRecord[]> {
    const where: any = {};
    if (filters?.ownerUserId) where.ownerUserId = filters.ownerUserId;
    if (filters?.teamId) where.teamId = filters.teamId;
    if (filters?.status) where.status = filters.status;
    if (filters?.providerSlug) where.providerSlug = filters.providerSlug;

    const rows = await prisma.dmDeployment.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(toRecord);
  }

  async deploy(id: string, userId: string): Promise<DeploymentRecord> {
    let record = await this.getOrThrow(id);
    this.assertTransition(record.status, 'PROVISIONING');

    const adapter = this.registry.get(record.providerSlug);
    record = await this.transition(record, 'PROVISIONING', 'Deploy initiated', userId);

    setCurrentUserId(userId);
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

      const updated = await prisma.dmDeployment.update({
        where: { id },
        data: {
          providerDeploymentId: result.providerDeploymentId,
          endpointUrl: result.endpointUrl,
          deployedAt: new Date(),
          status: 'DEPLOYING',
        },
      });
      await this.recordTransition(id, 'PROVISIONING', 'DEPLOYING', 'Provider accepted deployment', userId, {
        providerDeploymentId: result.providerDeploymentId,
        endpointUrl: result.endpointUrl,
        dockerImage: record.dockerImage,
        gpuModel: record.gpuModel,
        gpuCount: record.gpuCount,
        providerSlug: record.providerSlug,
        ...(result.metadata || {}),
      });

      await this.audit.log({
        deploymentId: id, action: 'DEPLOY', resource: 'deployment', resourceId: id, userId,
        details: { providerDeploymentId: result.providerDeploymentId, endpointUrl: result.endpointUrl },
        status: 'success',
      });

      return toRecord(updated);
    } catch (err: any) {
      await this.transition(record, 'FAILED', err.message, userId, {
        error: err.message, providerSlug: record.providerSlug,
      });
      await this.audit.log({
        deploymentId: id, action: 'DEPLOY', resource: 'deployment', resourceId: id, userId,
        status: 'failure', errorMsg: err.message,
      });
      throw err;
    } finally {
      setCurrentUserId(null);
    }
  }

  async destroy(id: string, userId: string): Promise<DeploymentRecord> {
    let record = await this.getOrThrow(id);
    this.assertTransition(record.status, 'DESTROYING');

    const adapter = this.registry.get(record.providerSlug);
    record = await this.transition(record, 'DESTROYING', 'Destroy initiated', userId);

    setCurrentUserId(userId);
    try {
      const destroyMeta: Record<string, unknown> = {
        providerDeploymentId: record.providerDeploymentId,
        providerSlug: record.providerSlug,
      };
      if (record.providerDeploymentId) {
        const result = await adapter.destroy(record.providerDeploymentId, record.providerConfig);
        if (result && typeof result === 'object' && 'steps' in result) {
          Object.assign(destroyMeta, { steps: result.steps, allClean: result.allClean });
        }
      }
      record = await this.transition(record, 'DESTROYED', 'Destroyed', userId, destroyMeta);
      await this.audit.log({
        deploymentId: id, action: 'DESTROY', resource: 'deployment', resourceId: id, userId,
        status: 'success', details: destroyMeta,
      });
      return record;
    } catch (err: any) {
      record = await this.transition(record, 'FAILED', err.message, userId, {
        providerDeploymentId: record.providerDeploymentId, error: err.message,
      });
      await this.audit.log({
        deploymentId: id, action: 'DESTROY', resource: 'deployment', resourceId: id, userId,
        status: 'failure', errorMsg: err.message,
      });
      throw err;
    } finally {
      setCurrentUserId(null);
    }
  }

  async syncStatus(id: string, userId: string): Promise<DeploymentRecord> {
    const record = await this.getOrThrow(id);
    if (!record.providerDeploymentId) {
      console.warn(`[syncStatus] ${id}: no providerDeploymentId, skipping`);
      return record;
    }

    const inProgressStates: DeploymentStatus[] = ['PROVISIONING', 'DEPLOYING', 'VALIDATING'];
    if (!inProgressStates.includes(record.status)) return record;

    const adapter = this.registry.get(record.providerSlug);
    setCurrentUserId(userId);
    try {
      const providerStatus = await adapter.getStatus(record.providerDeploymentId);
      console.log(`[syncStatus] ${id}: provider reported status="${providerStatus.status}", current="${record.status}"`);

      const providerMeta: Record<string, unknown> = {
        providerDeploymentId: record.providerDeploymentId,
        providerSlug: record.providerSlug,
        providerReportedStatus: providerStatus.status,
        ...(providerStatus.metadata || {}),
      };

      if (providerStatus.status === 'ONLINE') {
        const updated = await prisma.dmDeployment.update({
          where: { id },
          data: {
            status: 'ONLINE',
            healthStatus: 'GREEN',
            lastHealthCheck: new Date(),
            endpointUrl: providerStatus.endpointUrl || record.endpointUrl,
          },
        });
        await this.recordTransition(id, record.status, 'ONLINE', 'Provider reports ready', userId, {
          ...providerMeta, endpointUrl: providerStatus.endpointUrl || record.endpointUrl,
        });
        console.log(`[syncStatus] ${id}: transitioned to ONLINE`);
        return toRecord(updated);
      }

      if (providerStatus.status === 'FAILED') {
        const detail = (providerStatus.metadata as any)?.error || 'Provider reports deployment failed';
        const updated = await prisma.dmDeployment.update({
          where: { id },
          data: { status: 'FAILED', healthStatus: 'RED' },
        });
        await this.recordTransition(id, record.status, 'FAILED', detail, userId, providerMeta);
        return toRecord(updated);
      }

      if (providerStatus.status === 'DEGRADED') {
        const updated = await prisma.dmDeployment.update({
          where: { id },
          data: { status: 'ONLINE', healthStatus: 'ORANGE', lastHealthCheck: new Date(),
            endpointUrl: providerStatus.endpointUrl || record.endpointUrl },
        });
        await this.recordTransition(id, record.status, 'ONLINE', `Provider reports ${providerStatus.status} (endpoint exists)`, userId, providerMeta);
        return toRecord(updated);
      }

      // Still in progress — record snapshot so logs show provider state
      await this.recordTransition(
        id, record.status, record.status,
        `Provider status: ${providerStatus.status}`, 'system', providerMeta,
      );

      return record;
    } catch (err: any) {
      console.error(`[syncStatus] Failed to sync ${id}: ${err.message}`, err.stack);
      // Return record with sync error in metadata so frontend can see the issue
      return { ...record, statusMessage: `Sync error: ${err.message}` } as DeploymentRecord;
    } finally {
      setCurrentUserId(null);
    }
  }

  async updateDeployment(id: string, config: UpdateConfig, userId: string): Promise<DeploymentRecord> {
    let record = await this.getOrThrow(id);
    this.assertTransition(record.status, 'UPDATING');

    const adapter = this.registry.get(record.providerSlug);
    record = await this.transition(record, 'UPDATING', 'Update initiated', userId);

    setCurrentUserId(userId);
    try {
      const updateData: any = {};
      if (record.providerDeploymentId) {
        const result = await adapter.update(record.providerDeploymentId, config);
        if (result.endpointUrl) updateData.endpointUrl = result.endpointUrl;
      }
      if (config.artifactVersion) updateData.artifactVersion = config.artifactVersion;
      if (config.dockerImage) updateData.dockerImage = config.dockerImage;
      if (config.gpuModel) updateData.gpuModel = config.gpuModel;
      if (config.gpuVramGb) updateData.gpuVramGb = config.gpuVramGb;
      if (config.gpuCount) updateData.gpuCount = config.gpuCount;

      updateData.status = 'VALIDATING';
      const updated = await prisma.dmDeployment.update({ where: { id }, data: updateData });
      await this.recordTransition(id, 'UPDATING', 'VALIDATING', 'Update deployed, validating', userId);

      await this.audit.log({
        deploymentId: id, action: 'UPDATE', resource: 'deployment', resourceId: id, userId,
        details: config as Record<string, unknown>, status: 'success',
      });
      return toRecord(updated);
    } catch (err: any) {
      await this.transition(record, 'FAILED', err.message, userId);
      await this.audit.log({
        deploymentId: id, action: 'UPDATE', resource: 'deployment', resourceId: id, userId,
        status: 'failure', errorMsg: err.message,
      });
      throw err;
    } finally {
      setCurrentUserId(null);
    }
  }

  async validate(id: string, userId: string): Promise<DeploymentRecord> {
    const record = await this.getOrThrow(id);
    if (record.status !== 'VALIDATING' && record.status !== 'DEPLOYING') {
      throw new Error(`Cannot validate deployment in status ${record.status}`);
    }

    const adapter = this.registry.get(record.providerSlug);
    setCurrentUserId(userId);
    try {
      const health = await adapter.healthCheck(record.providerDeploymentId || '', record.endpointUrl || undefined);
      if (health.healthy) {
        const updated = await prisma.dmDeployment.update({
          where: { id },
          data: { status: 'ONLINE', healthStatus: 'GREEN', lastHealthCheck: new Date() },
        });
        await this.recordTransition(id, record.status, 'ONLINE', 'Validation passed', userId);
        return toRecord(updated);
      } else {
        const updated = await prisma.dmDeployment.update({
          where: { id },
          data: { status: 'FAILED', healthStatus: 'RED' },
        });
        await this.recordTransition(id, record.status, 'FAILED', 'Validation failed: health check returned unhealthy', userId);
        return toRecord(updated);
      }
    } catch (err: any) {
      await this.transition(record, 'FAILED', `Validation error: ${err.message}`, userId);
      throw err;
    } finally {
      setCurrentUserId(null);
    }
  }

  /**
   * Polls the provider for the actual deployment state and reconciles it with
   * NaaP's internal state. Call this for DEPLOYING / PROVISIONING deployments
   * so the UI reflects what's actually happening on the provider side.
   */
  async syncStatus(id: string, userId: string): Promise<DeploymentRecord> {
    const record = await this.getOrThrow(id);

    if (!record.providerDeploymentId) return record;

    const inProgressStates: DeploymentStatus[] = ['PROVISIONING', 'DEPLOYING', 'VALIDATING'];
    if (!inProgressStates.includes(record.status)) return record;

    const adapter = this.registry.get(record.providerSlug);
    setCurrentUserId(userId);
    try {
      const providerStatus = await adapter.getStatus(record.providerDeploymentId);

      if (providerStatus.status === 'ONLINE') {
        const updated = await prisma.dmDeployment.update({
          where: { id },
          data: {
            status: 'ONLINE',
            healthStatus: 'GREEN',
            lastHealthCheck: new Date(),
            endpointUrl: providerStatus.endpointUrl || record.endpointUrl,
          },
        });
        await this.recordTransition(id, record.status, 'ONLINE', 'Provider reports ready', userId);
        return toRecord(updated);
      }

      if (providerStatus.status === 'FAILED') {
        const detail = (providerStatus.metadata as any)?.error || 'Provider reports deployment failed';
        const updated = await prisma.dmDeployment.update({
          where: { id },
          data: { status: 'FAILED', healthStatus: 'RED' },
        });
        await this.recordTransition(id, record.status, 'FAILED', detail, userId);
        return toRecord(updated);
      }

      return record;
    } catch (err: any) {
      console.warn(`[syncStatus] Failed to sync ${id}: ${err.message}`);
      return record;
    } finally {
      setCurrentUserId(null);
    }
  }

  async retry(id: string, userId: string): Promise<DeploymentRecord> {
    const record = await this.getOrThrow(id);
    if (record.status !== 'FAILED') {
      throw new Error(`Can only retry FAILED deployments, current status: ${record.status}`);
    }
    this.assertTransition(record.status, 'PROVISIONING');
    return this.deploy(id, userId);
  }

  async getStatusHistory(deploymentId: string): Promise<StatusLogEntry[]> {
    const rows = await prisma.dmStatusLog.findMany({
      where: { deploymentId },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => ({
      id: r.id,
      deploymentId: r.deploymentId,
      fromStatus: (r.fromStatus as DeploymentStatus) ?? undefined,
      toStatus: r.toStatus as DeploymentStatus,
      reason: r.reason ?? undefined,
      initiatedBy: r.initiatedBy ?? undefined,
      metadata: (r.metadata as Record<string, unknown>) ?? undefined,
      createdAt: r.createdAt,
    }));
  }

  async updateHealthStatus(id: string, healthStatus: HealthStatus, healthDetails?: Record<string, unknown>): Promise<void> {
    const record = await this.get(id);
    if (!record) return;

    const data: any = { healthStatus, lastHealthCheck: new Date() };

    // Serverless endpoints report ORANGE when idle (scaled to zero) — this is
    // normal and should not trigger a DEGRADED transition.
    const isServerlessIdle = healthDetails?.isServerless === true && healthDetails?.note != null;

    if (record.status === 'ONLINE' && healthStatus === 'ORANGE' && !isServerlessIdle) {
      data.status = 'DEGRADED';
      await this.recordTransition(id, 'ONLINE', 'DEGRADED', 'Health degraded', 'system');
    } else if (record.status === 'ONLINE' && healthStatus === 'RED') {
      data.status = 'OFFLINE';
      await this.recordTransition(id, 'ONLINE', 'OFFLINE', 'Health check failed', 'system');
    } else if ((record.status === 'DEGRADED' || record.status === 'OFFLINE') && healthStatus === 'GREEN') {
      data.status = 'ONLINE';
      await this.recordTransition(id, record.status, 'ONLINE', 'Health recovered', 'system');
    }

    await prisma.dmDeployment.update({ where: { id }, data });
  }

  private async getOrThrow(id: string): Promise<DeploymentRecord> {
    const record = await this.get(id);
    if (!record) throw new Error(`Deployment not found: ${id}`);
    return record;
  }

  private assertTransition(from: DeploymentStatus, to: DeploymentStatus): void {
    const allowed = VALID_TRANSITIONS[from];
    if (!allowed || !allowed.includes(to)) {
      throw new Error(`Invalid state transition: ${from} -> ${to}`);
    }
  }

  private async transition(
    record: DeploymentRecord,
    to: DeploymentStatus,
    reason: string,
    initiatedBy: string,
    metadata?: Record<string, unknown>,
  ): Promise<DeploymentRecord> {
    const from = record.status;
    const updated = await prisma.dmDeployment.update({
      where: { id: record.id },
      data: { status: to },
    });
    await this.recordTransition(record.id, from, to, reason, initiatedBy, metadata);
    return toRecord(updated);
  }

  private async recordTransition(
    deploymentId: string,
    from: DeploymentStatus | string | undefined,
    to: DeploymentStatus | string,
    reason: string,
    initiatedBy: string,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    await prisma.dmStatusLog.create({
      data: {
        deploymentId,
        fromStatus: from ?? null,
        toStatus: to,
        reason,
        initiatedBy,
        metadata: metadata ?? undefined,
      },
    });
  }
}
