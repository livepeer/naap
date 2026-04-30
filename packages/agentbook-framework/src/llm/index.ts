export { LLMGateway, getLLMGateway } from './gateway.js';
export { GeminiProvider } from './providers/index.js';
export type { LLMProvider, LLMProviderConfig, LLMRequest, LLMResponse, LLMMessage } from './types.js';

/**
 * Initialize the LLM gateway with default Gemini provider.
 * Call this once at startup.
 */
export function initLLMGateway(configs?: import('./types.js').LLMProviderConfig[]): import('./gateway.js').LLMGateway {
  const gateway = getLLMGateway();

  // Register built-in providers
  gateway.registerProvider(new GeminiProvider());

  // Load configs from parameter or environment
  if (configs) {
    gateway.loadConfigs(configs);
  } else if (process.env.GOOGLE_GEMINI_API_KEY) {
    gateway.loadConfigs([{
      id: 'gemini-default',
      name: 'Google Gemini',
      provider: 'gemini',
      apiKey: process.env.GOOGLE_GEMINI_API_KEY,
      enabled: true,
      isDefault: true,
      models: {
        fast: 'gemini-2.0-flash',
        standard: 'gemini-2.5-flash',
        premium: 'gemini-2.5-pro',
        vision: 'gemini-2.5-flash',
      },
    }]);
  }

  return gateway;
}
