import type {
  ProviderMode,
  GpuOption,
  DeployConfig,
  UpdateConfig,
  ProviderDeployment,
  ProviderStatus,
  HealthResult,
  ProviderApiConfig,
} from '../types/index.js';

export interface DestroyStep {
  resource: string;
  resourceId?: string;
  action: string;
  status: 'ok' | 'failed' | 'skipped';
  detail?: string;
  error?: string;
}

export interface DestroyResult {
  allClean: boolean;
  steps: DestroyStep[];
}

export interface IProviderAdapter {
  readonly slug: string;
  readonly displayName: string;
  readonly mode: ProviderMode;
  readonly icon: string;
  readonly description: string;
  readonly authMethod: string;
  readonly apiConfig: ProviderApiConfig;

  getGpuOptions(): Promise<GpuOption[]>;

  deploy(config: DeployConfig): Promise<ProviderDeployment>;

  getStatus(providerDeploymentId: string): Promise<ProviderStatus>;

  destroy(providerDeploymentId: string, metadata?: Record<string, unknown>): Promise<DestroyResult | void>;

  update(providerDeploymentId: string, config: UpdateConfig): Promise<ProviderDeployment>;

  healthCheck(providerDeploymentId: string, endpointUrl?: string): Promise<HealthResult>;
}
