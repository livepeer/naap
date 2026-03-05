export type ProviderMode = 'serverless' | 'ssh-bridge';

export type DeploymentStatus =
  | 'PENDING'
  | 'DEPLOYING'
  | 'VALIDATING'
  | 'ONLINE'
  | 'UPDATING'
  | 'FAILED'
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
  artifactType: string;
  artifactVersion: string;
  dockerImage: string;
  healthPort?: number;
  healthEndpoint?: string;
  artifactConfig?: Record<string, unknown>;
  sshHost?: string;
  sshPort?: number;
  sshUsername?: string;
  containerName?: string;
  templateId?: string;
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
  connectorSlug: string;
  authMethod: string;
  gpuOptionsAvailable: boolean;
}

export interface DeploymentTemplate {
  id: string;
  name: string;
  description: string;
  icon: string;
  dockerImage: string;
  defaultVersion?: string;
  healthEndpoint: string;
  healthPort: number;
  defaultGpuModel?: string;
  defaultGpuVramGb?: number;
  envVars?: Record<string, string>;
  category: 'curated' | 'custom';
  githubOwner?: string;
  githubRepo?: string;
}
