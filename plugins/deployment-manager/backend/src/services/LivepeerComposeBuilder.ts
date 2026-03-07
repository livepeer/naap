import type { LivepeerInferenceConfig } from '../types/index.js';

/**
 * Generates docker-compose YAML for Livepeer inference deployments.
 *
 * All inter-container URLs are auto-wired using Docker Compose service names.
 * The user never needs to manually configure ORCH_URL, BACKEND_URL, or ORCH_SECRET.
 */
export class LivepeerComposeBuilder {
  /**
   * Build a docker-compose YAML string for the given configuration.
   */
  build(config: LivepeerInferenceConfig): { yaml: string; project: string; capabilityName: string; orchestratorSecret: string } {
    const secret = config.orchestratorSecret || crypto.randomUUID();
    const capabilityName = config.capabilityName || this.deriveCapabilityName(config);
    const project = `naap-livepeer-${Date.now().toString(36)}`;

    let compose: Record<string, unknown>;

    switch (config.topology) {
      case 'split-cpu-serverless':
        compose = this.buildTopology3(config, secret, capabilityName);
        break;
      case 'all-in-one':
        compose = this.buildTopology1(config, secret, capabilityName);
        break;
      case 'all-on-provider':
        compose = this.buildTopology2(config, secret, capabilityName);
        break;
      default:
        compose = this.buildTopology3(config, secret, capabilityName);
    }

    return {
      yaml: this.toYaml(compose),
      project,
      capabilityName,
      orchestratorSecret: secret,
    };
  }

  /**
   * Derive a capability name from the model configuration.
   *
   * Examples:
   *   "fal-ai/flux/dev" -> "flux-dev"
   *   "meta-llama/Llama-3.1-70B-Instruct" -> "llama-3-1-70b-instruct"
   *   "replicate/stability-ai/sdxl" -> "sdxl"
   */
  deriveCapabilityName(config: LivepeerInferenceConfig): string {
    const source = config.serverlessModelId || config.modelImage || 'inference';

    // Take the last meaningful segment(s)
    const parts = source.split('/').filter(Boolean);
    const meaningful = parts.length >= 2 ? parts.slice(-2).join('-') : parts[parts.length - 1] || 'inference';

    // Sanitize: lowercase, replace non-alphanumeric with dashes, collapse dashes
    return meaningful
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .substring(0, 63); // DNS-safe length
  }

  private buildTopology3(config: LivepeerInferenceConfig, secret: string, capabilityName: string): Record<string, unknown> {
    const providerEnv = this.getProviderEnv(config);

    return {
      version: '3.8',
      services: {
        'go-livepeer': this.buildOrchestratorService(config, secret),
        'inference-adapter': this.buildAdapterService(config, secret, capabilityName, 'http://serverless-proxy:8080'),
        'serverless-proxy': {
          image: 'livepeer/serverless-proxy:latest',
          restart: 'unless-stopped',
          environment: {
            PROVIDER: config.serverlessProvider || 'custom',
            ...providerEnv,
          },
          healthcheck: {
            test: ['CMD', 'curl', '-sf', 'http://localhost:8080/health'],
            interval: '15s',
            timeout: '5s',
            retries: 3,
            start_period: '10s',
          },
        },
      },
      networks: {
        default: { driver: 'bridge' },
      },
    };
  }

  private buildTopology1(config: LivepeerInferenceConfig, secret: string, capabilityName: string): Record<string, unknown> {
    const modelImage = config.modelImage || 'ghcr.io/huggingface/text-generation-inference:latest';

    return {
      version: '3.8',
      services: {
        'go-livepeer': this.buildOrchestratorService(config, secret),
        'inference-adapter': this.buildAdapterService(config, secret, capabilityName, 'http://model:8080'),
        model: {
          image: modelImage,
          restart: 'unless-stopped',
          deploy: {
            resources: {
              reservations: {
                devices: [{ driver: 'nvidia', count: 'all', capabilities: ['gpu'] }],
              },
            },
          },
          environment: {
            ...(config.serverlessModelId ? { MODEL_ID: config.serverlessModelId } : {}),
          },
          healthcheck: {
            test: ['CMD', 'curl', '-sf', 'http://localhost:8080/health'],
            interval: '15s',
            timeout: '5s',
            retries: 5,
            start_period: '120s',
          },
        },
      },
      networks: {
        default: { driver: 'bridge' },
      },
    };
  }

  private buildTopology2(config: LivepeerInferenceConfig, secret: string, capabilityName: string): Record<string, unknown> {
    // Same as topology 1 but without GPU reservation (provider handles GPU)
    const compose = this.buildTopology1(config, secret, capabilityName) as any;
    // Remove GPU reservation — the provider pod already has GPUs
    if (compose.services?.model?.deploy) {
      delete compose.services.model.deploy;
    }
    return compose;
  }

  private buildOrchestratorService(config: LivepeerInferenceConfig, secret: string): Record<string, unknown> {
    const serviceAddr = config.publicAddress || '0.0.0.0:7935';

    return {
      image: 'livepeer/go-livepeer:latest',
      restart: 'unless-stopped',
      ports: ['7935:7935'],
      command: [
        '-orchestrator',
        '-serviceAddr', serviceAddr,
        '-orchSecret', secret,
        '-v', '6',
      ],
      healthcheck: {
        test: ['CMD', 'curl', '-sf', 'http://localhost:7935/status'],
        interval: '15s',
        timeout: '5s',
        retries: 3,
        start_period: '30s',
      },
    };
  }

  private buildAdapterService(
    config: LivepeerInferenceConfig,
    secret: string,
    capabilityName: string,
    backendUrl: string,
  ): Record<string, unknown> {
    return {
      image: 'livepeer/inference-adapter:latest',
      restart: 'unless-stopped',
      depends_on: {
        'go-livepeer': { condition: 'service_healthy' },
      },
      environment: {
        ORCH_URL: 'http://go-livepeer:7935',
        ORCH_SECRET: secret,
        CAPABILITY_NAME: capabilityName,
        BACKEND_URL: backendUrl,
        ADAPTER_PORT: '9090',
        CAPACITY: String(config.capacity || 4),
        PRICE_PER_UNIT: String(config.pricePerUnit || 1000),
        BACKEND_HEALTH_PATH: '/health',
        BACKEND_INFERENCE_PATH: '/inference',
        HEALTH_CHECK_INTERVAL: '15',
        REGISTER_INTERVAL: '30',
      },
      ports: ['9090:9090'],
      healthcheck: {
        test: ['CMD', 'curl', '-sf', 'http://localhost:9090/health'],
        interval: '15s',
        timeout: '5s',
        retries: 3,
        start_period: '30s',
      },
    };
  }

  private getProviderEnv(config: LivepeerInferenceConfig): Record<string, string> {
    const env: Record<string, string> = {};

    switch (config.serverlessProvider) {
      case 'fal-ai':
        if (config.serverlessApiKey) env.FAL_KEY = config.serverlessApiKey;
        if (config.serverlessModelId) env.FAL_MODEL_ID = config.serverlessModelId;
        break;
      case 'replicate':
        if (config.serverlessApiKey) env.REPLICATE_API_TOKEN = config.serverlessApiKey;
        if (config.serverlessModelId) env.REPLICATE_MODEL = config.serverlessModelId;
        break;
      case 'runpod':
        if (config.serverlessApiKey) env.RUNPOD_API_KEY = config.serverlessApiKey;
        if (config.serverlessModelId) env.RUNPOD_ENDPOINT_ID = config.serverlessModelId;
        break;
      case 'custom':
        if (config.serverlessEndpointUrl) env.CUSTOM_ENDPOINT_URL = config.serverlessEndpointUrl;
        if (config.serverlessApiKey) env.CUSTOM_API_KEY = config.serverlessApiKey;
        break;
    }

    return env;
  }

  /**
   * Convert a compose object to YAML string.
   * Uses JSON-based serialization for safety (no YAML injection).
   */
  private toYaml(obj: Record<string, unknown>): string {
    return this.jsonToYaml(obj, 0);
  }

  private jsonToYaml(value: unknown, indent: number): string {
    const pad = '  '.repeat(indent);

    if (value === null || value === undefined) return '';
    if (typeof value === 'string') return this.quoteYamlString(value);
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);

    if (Array.isArray(value)) {
      if (value.length === 0) return '[]';
      return value
        .map((item) => {
          if (typeof item === 'object' && item !== null && !Array.isArray(item)) {
            const entries = Object.entries(item as Record<string, unknown>);
            const first = entries[0];
            const rest = entries.slice(1);
            let result = `${pad}- ${first[0]}: ${this.jsonToYaml(first[1], indent + 2).trim()}`;
            for (const [k, v] of rest) {
              result += `\n${pad}  ${k}: ${this.jsonToYaml(v, indent + 2).trim()}`;
            }
            return result;
          }
          return `${pad}- ${this.jsonToYaml(item, indent + 1).trim()}`;
        })
        .join('\n');
    }

    if (typeof value === 'object') {
      const entries = Object.entries(value as Record<string, unknown>);
      if (entries.length === 0) return '{}';
      return entries
        .map(([key, val]) => {
          if (typeof val === 'object' && val !== null) {
            const nested = this.jsonToYaml(val, indent + 1);
            return `${pad}${key}:\n${nested}`;
          }
          return `${pad}${key}: ${this.jsonToYaml(val, indent + 1).trim()}`;
        })
        .join('\n');
    }

    return String(value);
  }

  private quoteYamlString(s: string): string {
    // Always quote strings that could be misinterpreted by YAML
    if (
      s === '' ||
      s === 'true' || s === 'false' ||
      s === 'null' || s === 'yes' || s === 'no' ||
      /^[0-9]/.test(s) ||
      /[:{}\[\],&*#?|<>=!%@`]/.test(s) ||
      s.includes('\n')
    ) {
      // Use single quotes, escaping internal single quotes
      return `'${s.replace(/'/g, "''")}'`;
    }
    return s;
  }
}
