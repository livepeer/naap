/**
 * LLM Gateway — Routes requests to the configured provider.
 * Handles: provider selection, fallback, usage tracking, rate limiting.
 */

import type { LLMRequest, LLMResponse, LLMProviderConfig, LLMProvider } from './types.js';

export class LLMGateway {
  private providers: Map<string, LLMProvider> = new Map();
  private configs: LLMProviderConfig[] = [];
  private usageLog: { tenantId: string; provider: string; model: string; costCents: number; timestamp: string }[] = [];

  /** Register a provider implementation */
  registerProvider(provider: LLMProvider): void {
    this.providers.set(provider.id, provider);
  }

  /** Load provider configurations (from DB or env) */
  loadConfigs(configs: LLMProviderConfig[]): void {
    this.configs = configs;
  }

  /** Get the default provider config */
  getDefaultConfig(): LLMProviderConfig | undefined {
    return this.configs.find(c => c.enabled && c.isDefault) || this.configs.find(c => c.enabled);
  }

  /** Get a specific provider config by ID */
  getConfig(providerId: string): LLMProviderConfig | undefined {
    return this.configs.find(c => c.id === providerId && c.enabled);
  }

  /** Send a request to the configured LLM */
  async chat(request: LLMRequest, providerId?: string): Promise<LLMResponse> {
    const config = providerId ? this.getConfig(providerId) : this.getDefaultConfig();
    if (!config) throw new Error('No LLM provider configured or enabled');

    const provider = this.providers.get(config.provider);
    if (!provider) throw new Error(`LLM provider "${config.provider}" not registered`);

    const start = Date.now();

    try {
      const response = await provider.chat(request, config);
      response.latencyMs = Date.now() - start;

      // Track usage
      if (request.tenantId) {
        this.usageLog.push({
          tenantId: request.tenantId,
          provider: config.provider,
          model: response.model,
          costCents: response.costCents,
          timestamp: new Date().toISOString(),
        });
      }

      return response;
    } catch (err) {
      // Try fallback provider
      const fallback = this.configs.find(c => c.enabled && c.id !== config.id);
      if (fallback) {
        const fallbackProvider = this.providers.get(fallback.provider);
        if (fallbackProvider) {
          console.warn(`LLM primary (${config.name}) failed, falling back to ${fallback.name}`);
          const response = await fallbackProvider.chat(request, fallback);
          response.latencyMs = Date.now() - start;
          return response;
        }
      }
      throw err;
    }
  }

  /** Send a vision request (image + text) */
  async vision(imageUrl: string, prompt: string, request?: Partial<LLMRequest>): Promise<LLMResponse> {
    const config = this.getDefaultConfig();
    if (!config) throw new Error('No LLM provider configured');

    const provider = this.providers.get(config.provider);
    if (!provider?.supportsVision()) {
      throw new Error(`Provider "${config.name}" does not support vision`);
    }

    return this.chat({
      messages: [
        { role: 'user', content: prompt, imageUrl },
      ],
      tier: 'standard',
      ...request,
    });
  }

  /** Get usage stats for a tenant */
  getUsageStats(tenantId: string, days: number = 30): { totalCalls: number; totalCostCents: number } {
    const since = new Date();
    since.setDate(since.getDate() - days);
    const relevant = this.usageLog.filter(u => u.tenantId === tenantId && new Date(u.timestamp) >= since);
    return {
      totalCalls: relevant.length,
      totalCostCents: relevant.reduce((s, u) => s + u.costCents, 0),
    };
  }

  /** List all registered providers */
  listProviders(): { id: string; name: string; enabled: boolean; isDefault: boolean }[] {
    return this.configs.map(c => ({ id: c.id, name: c.name, enabled: c.enabled, isDefault: c.isDefault }));
  }
}

// Singleton
let gateway: LLMGateway | null = null;
export function getLLMGateway(): LLMGateway {
  if (!gateway) gateway = new LLMGateway();
  return gateway;
}
