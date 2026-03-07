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
  envVars?: Record<string, string>;
  concurrency?: number;
  estimatedCostPerHour?: number;
  livepeerConfig?: LivepeerInferenceConfig;
}

export interface UpdateConfig {
  artifactVersion?: string;
  dockerImage?: string;
  gpuModel?: string;
  gpuVramGb?: number;
  gpuCount?: number;
  artifactConfig?: Record<string, unknown>;
  envVars?: Record<string, string>;
  concurrency?: number;
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

export interface ProviderApiConfig {
  upstreamBaseUrl: string;
  authType: 'bearer' | 'header' | 'none';
  authHeaderName?: string;
  authHeaderTemplate?: string;
  secretNames: string[];
  healthCheckPath?: string | null;
}

export interface ProviderInfo {
  slug: string;
  displayName: string;
  description: string;
  icon: string;
  mode: ProviderMode;
  authMethod: string;
  gpuOptionsAvailable: boolean;
  secretNames: string[];
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

// Livepeer inference adapter types
export type LivepeerTopology = 'all-in-one' | 'all-on-provider' | 'split-cpu-serverless';

export interface LivepeerInferenceConfig {
  topology: LivepeerTopology;
  orchestratorSecret?: string;
  capabilityName?: string;
  pricePerUnit?: number;
  capacity?: number;
  publicAddress?: string;
  // Model settings (topology 1 & 2)
  modelImage?: string;
  // Serverless settings (topology 3)
  serverlessProvider?: string;
  serverlessApiKey?: string;
  serverlessModelId?: string;
  serverlessEndpointUrl?: string;
}

export interface CostEstimate {
  gpuCostPerHour: number;
  totalCostPerHour: number;
  totalCostPerDay: number;
  totalCostPerMonth: number;
  currency: string;
  breakdown: {
    gpu: number;
    storage?: number;
    network?: number;
  };
  providerSlug: string;
  gpuModel: string;
  gpuCount: number;
}
