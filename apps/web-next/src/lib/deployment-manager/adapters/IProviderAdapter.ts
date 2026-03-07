import type {
  ProviderMode,
  ProviderApiConfig,
  GpuOption,
  DeployConfig,
  UpdateConfig,
  ProviderDeployment,
  ProviderStatus,
  HealthResult,
} from '../types';

export interface IProviderAdapter {
  readonly slug: string;
  readonly displayName: string;
  readonly apiConfig: ProviderApiConfig;
  readonly mode: ProviderMode;
  readonly icon: string;
  readonly description: string;
  readonly authMethod: string;

  getGpuOptions(): Promise<GpuOption[]>;
  deploy(config: DeployConfig): Promise<ProviderDeployment>;
  getStatus(providerDeploymentId: string): Promise<ProviderStatus>;
  destroy(providerDeploymentId: string): Promise<void>;
  update(providerDeploymentId: string, config: UpdateConfig): Promise<ProviderDeployment>;
  healthCheck(providerDeploymentId: string, endpointUrl?: string): Promise<HealthResult>;
}
