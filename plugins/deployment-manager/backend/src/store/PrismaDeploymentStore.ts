import type {
  IDeploymentStore,
  DeploymentRecord,
  DeploymentFilters,
  StatusLogEntry,
} from './IDeploymentStore.js';
import type { DeploymentStatus, HealthStatus } from '../types/index.js';

let prismaClient: any = null;

async function getPrisma() {
  if (!prismaClient) {
    try {
      const db = await import('@naap/database');
      prismaClient = db.prisma;
    } catch {
      throw new Error('Prisma client not available. Ensure @naap/database is installed.');
    }
  }
  return prismaClient;
}

function toRecord(row: any): DeploymentRecord {
  return {
    id: row.id,
    name: row.name,
    teamId: row.teamId ?? undefined,
    ownerUserId: row.ownerUserId,
    providerSlug: row.providerSlug,
    providerMode: row.providerMode,
    providerConfig: row.providerConfig as Record<string, unknown> | undefined,
    connectorId: row.connectorId ?? undefined,
    gpuModel: row.gpuModel,
    gpuVramGb: row.gpuVramGb,
    gpuCount: row.gpuCount,
    cudaVersion: row.cudaVersion ?? undefined,
    artifactType: row.artifactType,
    artifactVersion: row.artifactVersion,
    dockerImage: row.dockerImage,
    healthPort: row.healthPort ?? undefined,
    healthEndpoint: row.healthEndpoint ?? undefined,
    artifactConfig: row.artifactConfig as Record<string, unknown> | undefined,
    envVars: row.envVars as Record<string, string> | undefined,
    concurrency: row.concurrency ?? undefined,
    estimatedCostPerHour: row.estimatedCostPerHour ?? undefined,
    status: row.status as DeploymentStatus,
    healthStatus: row.healthStatus as HealthStatus,
    providerDeploymentId: row.providerDeploymentId ?? undefined,
    endpointUrl: row.endpointUrl ?? undefined,
    sshHost: row.sshHost ?? undefined,
    sshPort: row.sshPort ?? undefined,
    sshUsername: row.sshUsername ?? undefined,
    containerName: row.containerName ?? undefined,
    templateId: row.templateId ?? undefined,
    latestAvailableVersion: row.latestAvailableVersion ?? undefined,
    hasUpdate: row.hasUpdate,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    lastHealthCheck: row.lastHealthCheck ?? undefined,
    deployedAt: row.deployedAt ?? undefined,
  };
}

function toStatusLogEntry(row: any): StatusLogEntry {
  return {
    id: row.id,
    deploymentId: row.deploymentId,
    fromStatus: (row.fromStatus as DeploymentStatus) ?? undefined,
    toStatus: row.toStatus as DeploymentStatus,
    reason: row.reason ?? undefined,
    initiatedBy: row.initiatedBy ?? undefined,
    metadata: row.metadata as Record<string, unknown> | undefined,
    createdAt: row.createdAt,
  };
}

export class PrismaDeploymentStore implements IDeploymentStore {
  async create(record: DeploymentRecord): Promise<DeploymentRecord> {
    const prisma = await getPrisma();
    const row = await prisma.dmDeployment.create({
      data: {
        id: record.id,
        name: record.name,
        teamId: record.teamId ?? null,
        ownerUserId: record.ownerUserId,
        providerSlug: record.providerSlug,
        providerMode: record.providerMode,
        providerConfig: record.providerConfig ?? undefined,
        connectorId: record.connectorId ?? null,
        gpuModel: record.gpuModel,
        gpuVramGb: record.gpuVramGb,
        gpuCount: record.gpuCount,
        cudaVersion: record.cudaVersion ?? null,
        artifactType: record.artifactType,
        artifactVersion: record.artifactVersion,
        dockerImage: record.dockerImage,
        healthPort: record.healthPort ?? null,
        healthEndpoint: record.healthEndpoint ?? null,
        artifactConfig: record.artifactConfig ?? undefined,
        envVars: record.envVars ?? undefined,
        concurrency: record.concurrency ?? null,
        estimatedCostPerHour: record.estimatedCostPerHour ?? null,
        templateId: record.templateId ?? null,
        status: record.status,
        healthStatus: record.healthStatus,
        providerDeploymentId: record.providerDeploymentId ?? null,
        endpointUrl: record.endpointUrl ?? null,
        sshHost: record.sshHost ?? null,
        sshPort: record.sshPort ?? null,
        sshUsername: record.sshUsername ?? null,
        containerName: record.containerName ?? null,
        latestAvailableVersion: record.latestAvailableVersion ?? null,
        hasUpdate: record.hasUpdate,
        lastHealthCheck: record.lastHealthCheck ?? null,
        deployedAt: record.deployedAt ?? null,
      },
    });
    return toRecord(row);
  }

  async get(id: string): Promise<DeploymentRecord | undefined> {
    const prisma = await getPrisma();
    const row = await prisma.dmDeployment.findUnique({ where: { id } });
    return row ? toRecord(row) : undefined;
  }

  async list(filters?: DeploymentFilters): Promise<DeploymentRecord[]> {
    const prisma = await getPrisma();
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

  async update(id: string, data: Partial<DeploymentRecord>): Promise<DeploymentRecord> {
    const prisma = await getPrisma();

    const updateData: any = {};
    if (data.name !== undefined) updateData.name = data.name;
    if (data.teamId !== undefined) updateData.teamId = data.teamId ?? null;
    if (data.providerSlug !== undefined) updateData.providerSlug = data.providerSlug;
    if (data.providerMode !== undefined) updateData.providerMode = data.providerMode;
    if (data.providerConfig !== undefined) updateData.providerConfig = data.providerConfig;
    if (data.connectorId !== undefined) updateData.connectorId = data.connectorId ?? null;
    if (data.gpuModel !== undefined) updateData.gpuModel = data.gpuModel;
    if (data.gpuVramGb !== undefined) updateData.gpuVramGb = data.gpuVramGb;
    if (data.gpuCount !== undefined) updateData.gpuCount = data.gpuCount;
    if (data.cudaVersion !== undefined) updateData.cudaVersion = data.cudaVersion ?? null;
    if (data.artifactType !== undefined) updateData.artifactType = data.artifactType;
    if (data.artifactVersion !== undefined) updateData.artifactVersion = data.artifactVersion;
    if (data.dockerImage !== undefined) updateData.dockerImage = data.dockerImage;
    if (data.healthPort !== undefined) updateData.healthPort = data.healthPort ?? null;
    if (data.healthEndpoint !== undefined) updateData.healthEndpoint = data.healthEndpoint ?? null;
    if (data.artifactConfig !== undefined) updateData.artifactConfig = data.artifactConfig;
    if (data.envVars !== undefined) updateData.envVars = data.envVars;
    if (data.concurrency !== undefined) updateData.concurrency = data.concurrency ?? null;
    if (data.estimatedCostPerHour !== undefined) updateData.estimatedCostPerHour = data.estimatedCostPerHour ?? null;
    if (data.templateId !== undefined) updateData.templateId = data.templateId ?? null;
    if (data.status !== undefined) updateData.status = data.status;
    if (data.healthStatus !== undefined) updateData.healthStatus = data.healthStatus;
    if (data.providerDeploymentId !== undefined) updateData.providerDeploymentId = data.providerDeploymentId ?? null;
    if (data.endpointUrl !== undefined) updateData.endpointUrl = data.endpointUrl ?? null;
    if (data.sshHost !== undefined) updateData.sshHost = data.sshHost ?? null;
    if (data.sshPort !== undefined) updateData.sshPort = data.sshPort ?? null;
    if (data.sshUsername !== undefined) updateData.sshUsername = data.sshUsername ?? null;
    if (data.containerName !== undefined) updateData.containerName = data.containerName ?? null;
    if (data.latestAvailableVersion !== undefined) updateData.latestAvailableVersion = data.latestAvailableVersion ?? null;
    if (data.hasUpdate !== undefined) updateData.hasUpdate = data.hasUpdate;
    if (data.lastHealthCheck !== undefined) updateData.lastHealthCheck = data.lastHealthCheck ?? null;
    if (data.deployedAt !== undefined) updateData.deployedAt = data.deployedAt ?? null;

    const row = await prisma.dmDeployment.update({
      where: { id },
      data: updateData,
    });
    return toRecord(row);
  }

  async remove(id: string): Promise<boolean> {
    const prisma = await getPrisma();
    try {
      await prisma.dmDeployment.delete({ where: { id } });
      return true;
    } catch {
      return false;
    }
  }

  async addStatusLog(entry: StatusLogEntry): Promise<void> {
    const prisma = await getPrisma();
    await prisma.dmStatusLog.create({
      data: {
        id: entry.id,
        deploymentId: entry.deploymentId,
        fromStatus: entry.fromStatus ?? null,
        toStatus: entry.toStatus,
        reason: entry.reason ?? null,
        initiatedBy: entry.initiatedBy ?? null,
        metadata: entry.metadata ?? undefined,
      },
    });
  }

  async getStatusLogs(deploymentId: string): Promise<StatusLogEntry[]> {
    const prisma = await getPrisma();
    const rows = await prisma.dmStatusLog.findMany({
      where: { deploymentId },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(toStatusLogEntry);
  }
}
