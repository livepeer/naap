export type ProviderMode = 'serverless' | 'ssh-bridge';

export type DeploymentStatus =
  | 'PENDING'
  | 'PROVISIONING'
  | 'DEPLOYING'
  | 'VALIDATING'
  | 'ONLINE'
  | 'DEGRADED'
  | 'OFFLINE'
  | 'UPDATING'
  | 'FAILED'
  | 'DESTROYING'
  | 'DESTROYED';

export type HealthStatus = 'GREEN' | 'ORANGE' | 'RED' | 'UNKNOWN';

export interface GpuOption {
  id: string;
  name: string;
  vramGb: number;
  cudaVersion?: string;
  available: boolean;
  pricePerHour?: number;
}

export interface DeployConfig {
  name: string;
  providerSlug: string;
  gpuModel: string;
  gpuVramGb: number;
  gpuCount: number;
  cudaVersion?: string;
  artifactType: 'ai-runner' | 'scope';
  artifactVersion: string;
  dockerImage: string;
  artifactConfig?: Record<string, unknown>;
  sshHost?: string;
  sshPort?: number;
  sshUsername?: string;
  containerName?: string;
}

export interface UpdateConfig {
  artifactVersion?: string;
  dockerImage?: string;
  gpuModel?: string;
  gpuVramGb?: number;
  gpuCount?: number;
  artifactConfig?: Record<string, unknown>;
}

export interface ProviderDeployment {
  providerDeploymentId: string;
  endpointUrl?: string;
  status: DeploymentStatus;
  metadata?: Record<string, unknown>;
}

export interface ProviderStatus {
  status: DeploymentStatus;
  endpointUrl?: string;
  metadata?: Record<string, unknown>;
}

export interface HealthResult {
  healthy: boolean;
  status: HealthStatus;
  responseTimeMs?: number;
  statusCode?: number;
  details?: Record<string, unknown>;
}

export interface ProviderInfo {
  slug: string;
  displayName: string;
  description: string;
  icon: string;
  mode: ProviderMode;
  authMethod: string;
  secretNames: string[];
  gpuOptionsAvailable: boolean;
}

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

export interface StatusLogEntry {
  id: string;
  deploymentId: string;
  fromStatus?: DeploymentStatus;
  toStatus: DeploymentStatus;
  reason?: string;
  initiatedBy?: string;
  metadata?: Record<string, unknown>;
  createdAt: Date;
}

export interface AuditEntry {
  deploymentId?: string;
  action: string;
  resource: string;
  resourceId?: string;
  userId: string;
  ipAddress?: string;
  userAgent?: string;
  details?: Record<string, unknown>;
  status: 'success' | 'failure';
  errorMsg?: string;
}

export interface DeploymentFilters {
  ownerUserId?: string;
  teamId?: string;
  status?: DeploymentStatus;
  providerSlug?: string;
}

export interface ProviderApiConfig {
  upstreamBaseUrl: string;
  authType: 'bearer' | 'header' | 'none';
  authHeaderName?: string;
  authHeaderTemplate?: string;
  secretNames: string[];
  healthCheckPath?: string | null;
}
