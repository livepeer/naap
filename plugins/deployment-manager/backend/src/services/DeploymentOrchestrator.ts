import type { DeploymentStatus, DeployConfig, UpdateConfig, HealthStatus } from '../types/index.js';
import type { ProviderAdapterRegistry } from './ProviderAdapterRegistry.js';
import type { AuditService } from './AuditService.js';
import type { IProviderAdapter, DestroyResult } from '../adapters/IProviderAdapter.js';
import type { IDeploymentStore, DeploymentFilters, StatusLogEntry } from '../store/IDeploymentStore.js';
import { setSystemUserId } from '../lib/providerFetch.js';

export type { DeploymentRecord } from '../store/IDeploymentStore.js';
import type { DeploymentRecord } from '../store/IDeploymentStore.js';

const VALID_TRANSITIONS: Record<DeploymentStatus, DeploymentStatus[]> = {
  PENDING: ['DEPLOYING', 'DESTROYING', 'DESTROYED'],
  PROVISIONING: ['DEPLOYING', 'FAILED', 'DESTROYING', 'DESTROYED'],
  DEPLOYING: ['VALIDATING', 'ONLINE', 'FAILED', 'DESTROYING', 'DESTROYED'],
  VALIDATING: ['ONLINE', 'FAILED', 'DESTROYING', 'DESTROYED'],
  ONLINE: ['DEGRADED', 'OFFLINE', 'UPDATING', 'DESTROYING', 'DESTROYED'],
  DEGRADED: ['ONLINE', 'OFFLINE', 'DESTROYING', 'DESTROYED'],
  OFFLINE: ['ONLINE', 'DESTROYING', 'DESTROYED'],
  UPDATING: ['VALIDATING', 'FAILED', 'DESTROYING', 'DESTROYED'],
  FAILED: ['DEPLOYING', 'DESTROYING', 'DESTROYED'],
  DESTROYING: ['DESTROYED', 'FAILED'],
  DESTROYED: [],
};

export class DeploymentOrchestrator {
  constructor(
    private registry: ProviderAdapterRegistry,
    private audit: AuditService,
    private store: IDeploymentStore,
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
      healthPort: config.healthPort,
      healthEndpoint: config.healthEndpoint,
      artifactConfig: config.artifactConfig,
      status: 'PENDING',
      healthStatus: 'UNKNOWN',
      sshHost: config.sshHost,
      sshPort: config.sshPort,
      sshUsername: config.sshUsername,
      containerName: config.containerName,
      templateId: config.templateId,
      envVars: config.envVars,
      concurrency: config.concurrency,
      estimatedCostPerHour: config.estimatedCostPerHour,
      hasUpdate: false,
      createdAt: now,
      updatedAt: now,
    };

    const created = await this.store.create(record);
    await this.recordTransition(id, undefined, 'PENDING', 'Created', userId);

    await this.audit.log({
      deploymentId: id,
      action: 'CREATE',
      resource: 'deployment',
      resourceId: id,
      userId,
      details: { name: config.name, provider: config.providerSlug, artifact: config.artifactType },
      status: 'success',
    });

    return created;
  }

  async get(id: string): Promise<DeploymentRecord | undefined> {
    return this.store.get(id);
  }

  async list(filters?: DeploymentFilters): Promise<DeploymentRecord[]> {
    return this.store.list(filters);
  }

  /**
   * Unified deploy flow: PENDING -> DEPLOYING -> (poll if SSH) -> VALIDATING -> ONLINE
   * Always runs the full deploy + validate pipeline.
   */
  async deploy(id: string, userId: string): Promise<DeploymentRecord> {
    let record = await this.getOrThrow(id);
    this.assertTransition(record.status, 'DEPLOYING');

    const adapter = this.registry.get(record.providerSlug);
    record = await this.transition(record, 'DEPLOYING', 'Deploy initiated', userId);

    try {
      await this.recordTransitionWithMetadata(
        id, 'DEPLOYING', 'DEPLOYING', 'Sending deployment request to provider', userId,
        { providerSlug: record.providerSlug, dockerImage: record.dockerImage, gpuModel: record.gpuModel },
      );

      const result = await adapter.deploy({
        name: record.name,
        providerSlug: record.providerSlug,
        gpuModel: record.gpuModel,
        gpuVramGb: record.gpuVramGb,
        gpuCount: record.gpuCount,
        cudaVersion: record.cudaVersion,
        artifactType: record.artifactType,
        artifactVersion: record.artifactVersion,
        dockerImage: record.dockerImage,
        healthPort: record.healthPort,
        healthEndpoint: record.healthEndpoint,
        artifactConfig: record.artifactConfig,
        sshHost: record.sshHost,
        sshPort: record.sshPort,
        sshUsername: record.sshUsername,
        containerName: record.containerName,
        envVars: record.envVars,
        concurrency: record.concurrency,
      });

      record = await this.store.update(id, {
        providerDeploymentId: result.providerDeploymentId,
        endpointUrl: result.endpointUrl,
        providerConfig: result.metadata || undefined,
        deployedAt: new Date(),
      });

      const deployMeta: Record<string, unknown> = {
        providerDeploymentId: result.providerDeploymentId,
        endpointUrl: result.endpointUrl,
        dockerImage: record.dockerImage,
        gpuModel: record.gpuModel,
        gpuCount: record.gpuCount,
        providerSlug: record.providerSlug,
        ...(result.metadata || {}),
      };
      await this.recordTransitionWithMetadata(
        id, 'DEPLOYING', 'DEPLOYING', 'Provider accepted deployment', userId, deployMeta,
      );

      await this.audit.log({
        deploymentId: id,
        action: 'DEPLOY',
        resource: 'deployment',
        resourceId: id,
        userId,
        details: deployMeta,
        status: 'success',
      });

      if (record.providerMode === 'ssh-bridge' && record.providerDeploymentId) {
        // SSH deployments: poll until provider reports ready, then validate
        record = await this.pollUntilReady(adapter, record, userId);
        if (record.status === 'FAILED') return record;
        await this.recordTransitionWithMetadata(
          id, 'VALIDATING', 'VALIDATING', 'Running health check against endpoint', userId,
          { endpointUrl: record.endpointUrl, providerMode: record.providerMode },
        );
        return await this.runValidation(record, adapter, userId);
      }

      // Serverless providers (RunPod, etc.): the endpoint was just created and
      // needs time to initialize. Stay in DEPLOYING — the frontend polls
      // syncStatus every 5s which will advance to ONLINE once the provider is ready.
      await this.recordTransitionWithMetadata(
        id, 'DEPLOYING', 'DEPLOYING',
        'Endpoint created — waiting for provider to finish initializing',
        userId,
        { endpointUrl: record.endpointUrl, providerMode: record.providerMode },
      );
      return record;
    } catch (err: any) {
      await this.transition(record, 'FAILED', err.message, userId);
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

  async destroy(id: string, userId: string): Promise<{ record: DeploymentRecord; destroyResult?: DestroyResult }> {
    let record = await this.getOrThrow(id);
    this.assertTransition(record.status, 'DESTROYED');

    const adapter = this.registry.get(record.providerSlug);
    let destroyResult: DestroyResult | undefined;

    if (record.providerDeploymentId) {
      const result = await adapter.destroy(record.providerDeploymentId, record.providerConfig || undefined);
      if (result && typeof result === 'object' && 'allClean' in result) {
        destroyResult = result;
      }
    }

    const cleanupPending = destroyResult ? !destroyResult.allClean : false;
    const reason = cleanupPending
      ? 'Destroyed (remote cleanup incomplete)'
      : 'Destroyed';

    record = await this.store.update(id, {
      providerConfig: { ...(record.providerConfig || {}), cleanupPending },
    });
    record = await this.transitionWithMetadata(
      record, 'DESTROYED', reason, userId,
      destroyResult ? { steps: destroyResult.steps, allClean: destroyResult.allClean } : undefined,
    );

    await this.audit.log({
      deploymentId: id,
      action: 'DESTROY',
      resource: 'deployment',
      resourceId: id,
      userId,
      status: cleanupPending ? 'failure' : 'success',
      details: destroyResult ? { steps: destroyResult.steps } : undefined,
    });

    return { record, destroyResult };
  }

  async forceDestroy(id: string, userId: string): Promise<{ record: DeploymentRecord; destroyResult?: DestroyResult }> {
    let record = await this.getOrThrow(id);
    const adapter = this.registry.get(record.providerSlug);
    let destroyResult: DestroyResult | undefined;

    if (record.providerDeploymentId) {
      try {
        const result = await adapter.destroy(record.providerDeploymentId, record.providerConfig || undefined);
        if (result && typeof result === 'object' && 'allClean' in result) {
          destroyResult = result;
        }
      } catch (err: any) {
        destroyResult = { allClean: false, steps: [{ resource: 'adapter', action: 'DESTROY', status: 'failed', error: err.message }] };
      }
    }

    const cleanupPending = destroyResult ? !destroyResult.allClean : false;
    const reason = cleanupPending
      ? 'Force destroyed (remote cleanup incomplete)'
      : 'Force destroyed';

    record = await this.store.update(id, {
      status: 'DESTROYED',
      providerConfig: { ...(record.providerConfig || {}), cleanupPending },
    });
    await this.recordTransitionWithMetadata(
      id, record.status, 'DESTROYED', reason, userId,
      destroyResult ? { steps: destroyResult.steps, allClean: destroyResult.allClean } : undefined,
    );

    await this.audit.log({
      deploymentId: id,
      action: 'FORCE_DESTROY',
      resource: 'deployment',
      resourceId: id,
      userId,
      status: cleanupPending ? 'failure' : 'success',
      details: destroyResult ? { steps: destroyResult.steps } : undefined,
    });

    return { record, destroyResult };
  }

  async retryCleanup(id: string, userId: string): Promise<{ record: DeploymentRecord; destroyResult?: DestroyResult }> {
    let record = await this.getOrThrow(id);
    if (record.status !== 'DESTROYED') {
      throw new Error(`Can only retry cleanup on DESTROYED deployments, current status: ${record.status}`);
    }

    const adapter = this.registry.get(record.providerSlug);
    let destroyResult: DestroyResult | undefined;

    if (record.providerDeploymentId) {
      try {
        const result = await adapter.destroy(record.providerDeploymentId, record.providerConfig || undefined);
        if (result && typeof result === 'object' && 'allClean' in result) {
          destroyResult = result;
        }
      } catch (err: any) {
        destroyResult = { allClean: false, steps: [{ resource: 'adapter', action: 'DESTROY', status: 'failed', error: err.message }] };
      }
    } else {
      destroyResult = { allClean: true, steps: [{ resource: 'deployment', action: 'CLEANUP', status: 'ok', detail: 'No provider deployment to clean' }] };
    }

    const cleanupPending = destroyResult ? !destroyResult.allClean : false;
    const reason = cleanupPending
      ? 'Retry cleanup (still incomplete)'
      : 'Retry cleanup (all clean)';

    record = await this.store.update(id, {
      providerConfig: { ...(record.providerConfig || {}), cleanupPending },
    });
    record = await this.transitionWithMetadata(
      record, 'DESTROYED', reason, userId,
      destroyResult ? { steps: destroyResult.steps, allClean: destroyResult.allClean } : undefined,
    );

    await this.audit.log({
      deploymentId: id,
      action: 'RETRY_CLEANUP',
      resource: 'deployment',
      resourceId: id,
      userId,
      status: cleanupPending ? 'failure' : 'success',
      details: destroyResult ? { steps: destroyResult.steps } : undefined,
    });

    return { record, destroyResult };
  }

  async updateDeployment(id: string, config: UpdateConfig, userId: string): Promise<DeploymentRecord> {
    let record = await this.getOrThrow(id);
    this.assertTransition(record.status, 'UPDATING');

    const adapter = this.registry.get(record.providerSlug);
    record = await this.transition(record, 'UPDATING', 'Update initiated', userId);

    try {
      const partial: Partial<DeploymentRecord> = {};

      if (record.providerDeploymentId) {
        const result = await adapter.update(record.providerDeploymentId, config);
        partial.providerDeploymentId = result.providerDeploymentId;
        if (result.endpointUrl) partial.endpointUrl = result.endpointUrl;
      }
      if (config.artifactVersion) partial.artifactVersion = config.artifactVersion;
      if (config.dockerImage) partial.dockerImage = config.dockerImage;
      if (config.gpuModel) partial.gpuModel = config.gpuModel;
      if (config.gpuVramGb) partial.gpuVramGb = config.gpuVramGb;
      if (config.gpuCount) partial.gpuCount = config.gpuCount;

      if (Object.keys(partial).length > 0) {
        record = await this.store.update(id, partial);
      }

      record = await this.transition(record, 'VALIDATING', 'Update deployed, validating', userId);

      await this.audit.log({
        deploymentId: id,
        action: 'UPDATE',
        resource: 'deployment',
        resourceId: id,
        userId,
        details: config as Record<string, unknown>,
        status: 'success',
      });

      return await this.runValidation(record, adapter, userId);
    } catch (err: any) {
      await this.transition(record, 'FAILED', err.message, userId);
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
    const record = await this.getOrThrow(id);
    if (record.status !== 'VALIDATING' && record.status !== 'DEPLOYING') {
      throw new Error(`Cannot validate deployment in status ${record.status}`);
    }

    const adapter = this.registry.get(record.providerSlug);
    return this.runValidation(record, adapter, userId);
  }

  async syncStatus(id: string, userId: string): Promise<DeploymentRecord> {
    let record = await this.getOrThrow(id);
    if (!record.providerDeploymentId) {
      console.warn(`[syncStatus] ${id}: no providerDeploymentId, skipping`);
      return record;
    }

    const inProgressStates: DeploymentStatus[] = ['PROVISIONING', 'DEPLOYING', 'VALIDATING'];
    if (!inProgressStates.includes(record.status)) return record;

    const adapter = this.registry.get(record.providerSlug);

    // Set system userId so background adapter calls (health monitor, polling)
    // can authenticate with the provider using the deployment owner's credentials.
    setSystemUserId(record.ownerUserId);
    try {
      const providerStatus = await adapter.getStatus(record.providerDeploymentId);
      console.log(`[syncStatus] ${id}: provider reported status="${providerStatus.status}", current="${record.status}"`);

      const providerMeta: Record<string, unknown> = {
        providerDeploymentId: record.providerDeploymentId,
        providerSlug: record.providerSlug,
        providerReportedStatus: providerStatus.status,
        ...(providerStatus.metadata || {}),
      };

      // Update endpoint URL if provider reports one
      if (providerStatus.endpointUrl && providerStatus.endpointUrl !== record.endpointUrl) {
        record = await this.store.update(id, { endpointUrl: providerStatus.endpointUrl });
      }

      if (providerStatus.status === 'ONLINE' || providerStatus.status === 'DEGRADED') {
        const healthStatus = providerStatus.status === 'ONLINE' ? 'GREEN' as HealthStatus : 'ORANGE' as HealthStatus;
        const reason = providerStatus.status === 'ONLINE'
          ? 'Provider reports ready'
          : `Provider reports ${providerStatus.status} (endpoint exists)`;
        record = await this.transitionWithMetadata(record, 'ONLINE', reason, userId, {
          ...providerMeta,
          endpointUrl: record.endpointUrl,
        });
        record = await this.store.update(id, {
          healthStatus,
          lastHealthCheck: new Date(),
        });
        console.log(`[syncStatus] ${id}: transitioned to ONLINE`);
        return record;
      }

      if (providerStatus.status === 'FAILED') {
        const detail = (providerStatus.metadata as any)?.error || 'Provider reports deployment failed';
        record = await this.transitionWithMetadata(record, 'FAILED', detail, userId, providerMeta);
        return record;
      }

      // Provider still reports DEPLOYING — try a health check to see if it's actually reachable.
      // Serverless endpoints (workersMin=0) can be idle but ready for cold-start requests.
      try {
        const health = await adapter.healthCheck(
          record.providerDeploymentId!,
          record.endpointUrl || undefined,
        );
        if (health.healthy) {
          record = await this.transitionWithMetadata(
            record, 'ONLINE',
            `Health check passed while provider reports ${providerStatus.status}`,
            userId, { ...providerMeta, healthDetails: health.details },
          );
          record = await this.store.update(id, {
            healthStatus: health.status === 'GREEN' ? 'GREEN' : 'ORANGE',
            lastHealthCheck: new Date(),
          });
          console.log(`[syncStatus] ${id}: health check passed, transitioned to ONLINE`);
          return record;
        }
      } catch {
        // Health check failed — endpoint not ready yet, continue waiting
      }

      await this.recordTransitionWithMetadata(
        id, record.status, record.status,
        `Still deploying — provider status: ${providerStatus.status}`, 'system',
        providerMeta,
      );

      return record;
    } catch (err: any) {
      console.error(`[syncStatus] Failed to sync ${id}: ${err.message}`, err.stack);
      return record;
    } finally {
      setSystemUserId(null);
    }
  }

  async retry(id: string, userId: string): Promise<DeploymentRecord> {
    const record = await this.getOrThrow(id);
    if (record.status !== 'FAILED') {
      throw new Error(`Can only retry FAILED deployments, current status: ${record.status}`);
    }
    return this.deploy(id, userId);
  }

  async remove(id: string): Promise<boolean> {
    return this.store.remove(id);
  }

  async getStatusHistory(deploymentId: string): Promise<StatusLogEntry[]> {
    return this.store.getStatusLogs(deploymentId);
  }

  async updateHealthStatus(id: string, healthStatus: HealthStatus, healthDetails?: Record<string, unknown>): Promise<void> {
    const record = await this.store.get(id);
    if (!record) return;

    const data: Partial<DeploymentRecord> = {
      healthStatus,
      lastHealthCheck: new Date(),
    };

    // Serverless endpoints scaled to zero report ORANGE — that's normal, don't degrade
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

    await this.store.update(id, data);
  }

  private async runValidation(
    record: DeploymentRecord,
    adapter: IProviderAdapter,
    userId: string,
  ): Promise<DeploymentRecord> {
    let health;
    try {
      health = await adapter.healthCheck(
        record.providerDeploymentId || '',
        record.endpointUrl || undefined,
      );
    } catch (err: any) {
      console.warn(`[runValidation] ${record.id}: healthCheck threw: ${err.message}`);
      health = { healthy: false, status: 'RED' as const, details: { error: err.message } };
    }

    if (health.healthy) {
      const hStatus = health.status === 'GREEN' ? 'GREEN' : 'ORANGE';
      record = await this.transitionWithMetadata(record, 'ONLINE', 'Validation passed — health check OK', userId, {
        healthStatus: hStatus, responseTimeMs: health.responseTimeMs, details: health.details,
      });
      record = await this.store.update(record.id, {
        healthStatus: hStatus,
        lastHealthCheck: new Date(),
      });
      return record;
    }

    // Health check failed — for serverless providers, the endpoint may be idle (workersMin=0)
    // but still ready to accept cold-start requests.
    if (record.providerMode === 'serverless') {
      try {
        const status = await adapter.getStatus(record.providerDeploymentId || '');
        if (status.status === 'ONLINE' || status.status === 'DEPLOYING' || status.status === 'DEGRADED') {
          record = await this.transitionWithMetadata(
            record, 'ONLINE', 'Serverless endpoint deployed (cold-start ready)', userId,
            { providerStatus: status.status, details: status.metadata },
          );
          record = await this.store.update(record.id, {
            healthStatus: 'ORANGE',
            lastHealthCheck: new Date(),
            endpointUrl: status.endpointUrl || record.endpointUrl,
          });
          return record;
        }
        record = await this.transitionWithMetadata(
          record, 'FAILED', `Validation failed: provider status=${status.status}`, userId,
          { providerStatus: status.status, details: status.metadata },
        );
      } catch (err: any) {
        record = await this.transition(record, 'FAILED', `Validation error: ${err.message}`, userId);
      }
      record = await this.store.update(record.id, { healthStatus: 'RED' });
      return record;
    }

    record = await this.transitionWithMetadata(
      record, 'FAILED', 'Validation failed: health check returned unhealthy', userId,
      { healthDetails: health.details },
    );
    record = await this.store.update(record.id, { healthStatus: 'RED' });
    return record;
  }

  private async pollUntilReady(
    adapter: IProviderAdapter,
    record: DeploymentRecord,
    userId: string,
  ): Promise<DeploymentRecord> {
    const maxAttempts = 60;
    for (let i = 0; i < maxAttempts; i++) {
      await new Promise((r) => setTimeout(r, 10_000));
      try {
        const status = await adapter.getStatus(record.providerDeploymentId!);
        if (status.status === 'ONLINE') {
          if (status.endpointUrl) {
            record = await this.store.update(record.id, { endpointUrl: status.endpointUrl });
          }
          record = await this.transition(record, 'VALIDATING', 'Provider reports ready', userId);
          return record;
        }
        if (status.status === 'FAILED') {
          record = await this.transition(record, 'FAILED', 'Provider reports failure', userId);
          return record;
        }
      } catch {
        // Continue polling on transient errors
      }
    }
    record = await this.transition(record, 'FAILED', 'Deployment timed out during polling', userId);
    return record;
  }

  private async getOrThrow(id: string): Promise<DeploymentRecord> {
    const record = await this.store.get(id);
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
  ): Promise<DeploymentRecord> {
    const from = record.status;
    const updated = await this.store.update(record.id, { status: to });
    await this.recordTransition(record.id, from, to, reason, initiatedBy);
    return updated;
  }

  private async transitionWithMetadata(
    record: DeploymentRecord,
    to: DeploymentStatus,
    reason: string,
    initiatedBy: string,
    metadata?: Record<string, unknown>,
  ): Promise<DeploymentRecord> {
    const from = record.status;
    const updated = await this.store.update(record.id, { status: to });
    await this.recordTransitionWithMetadata(record.id, from, to, reason, initiatedBy, metadata);
    return updated;
  }

  private async recordTransition(
    deploymentId: string,
    from: DeploymentStatus | undefined,
    to: DeploymentStatus,
    reason: string,
    initiatedBy: string,
  ): Promise<void> {
    await this.store.addStatusLog({
      id: crypto.randomUUID(),
      deploymentId,
      fromStatus: from,
      toStatus: to,
      reason,
      initiatedBy,
      createdAt: new Date(),
    });
  }

  private async recordTransitionWithMetadata(
    deploymentId: string,
    from: DeploymentStatus | undefined,
    to: DeploymentStatus,
    reason: string,
    initiatedBy: string,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    await this.store.addStatusLog({
      id: crypto.randomUUID(),
      deploymentId,
      fromStatus: from,
      toStatus: to,
      reason,
      initiatedBy,
      metadata,
      createdAt: new Date(),
    });
  }
}
