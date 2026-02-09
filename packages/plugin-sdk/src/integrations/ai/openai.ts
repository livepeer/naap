/**
 * OpenAI Integration
 * Provides AI/ML capabilities using OpenAI's API
 */

import type { 
  AIIntegration, 
  IntegrationConfig, 
  HealthStatus,
  AICompletionOptions,
  AIMessage,
  ModerationResult,
} from '../../types/integrations.js';

export class OpenAIIntegration implements AIIntegration {
  name = 'openai';
  type = 'openai';
  
  private apiKey: string = '';
  private organization?: string;
  private baseUrl = 'https://api.openai.com/v1';

  async initialize(config: IntegrationConfig): Promise<void> {
    this.apiKey = config.credentials.apiKey;
    this.organization = config.credentials.organization;
    
    if (!this.apiKey) {
      throw new Error('OpenAI API key is required');
    }
  }

  async healthCheck(): Promise<HealthStatus> {
    try {
      const startTime = Date.now();
      const response = await this.request('GET', '/models');
      
      return {
        healthy: response.ok,
        message: response.ok ? 'Connected' : `HTTP ${response.status}`,
        latency: Date.now() - startTime,
        lastCheck: new Date(),
      };
    } catch (error) {
      return {
        healthy: false,
        message: error instanceof Error ? error.message : 'Unknown error',
        lastCheck: new Date(),
      };
    }
  }

  async shutdown(): Promise<void> {
    // No cleanup needed
  }

  async validateCredentials(): Promise<boolean> {
    const health = await this.healthCheck();
    return health.healthy;
  }

  async complete(prompt: string, options?: AICompletionOptions): Promise<string> {
    const response = await this.request('POST', '/chat/completions', {
      model: options?.model || 'gpt-3.5-turbo',
      messages: [{ role: 'user', content: prompt }],
      temperature: options?.temperature ?? 0.7,
      max_tokens: options?.maxTokens,
      stop: options?.stopSequences,
    });

    const data = await response.json();
    return data.choices[0]?.message?.content || '';
  }

  async chat(messages: AIMessage[], options?: AICompletionOptions): Promise<string> {
    const response = await this.request('POST', '/chat/completions', {
      model: options?.model || 'gpt-3.5-turbo',
      messages: messages.map(m => ({ role: m.role, content: m.content })),
      temperature: options?.temperature ?? 0.7,
      max_tokens: options?.maxTokens,
      stop: options?.stopSequences,
    });

    const data = await response.json();
    return data.choices[0]?.message?.content || '';
  }

  async embed(text: string | string[]): Promise<number[] | number[][]> {
    const input = Array.isArray(text) ? text : [text];
    
    const response = await this.request('POST', '/embeddings', {
      model: 'text-embedding-ada-002',
      input,
    });

    const data = await response.json();
    const embeddings = data.data.map((d: { embedding: number[] }) => d.embedding);
    
    return Array.isArray(text) ? embeddings : embeddings[0];
  }

  async moderate(content: string): Promise<ModerationResult> {
    const response = await this.request('POST', '/moderations', {
      input: content,
    });

    const data = await response.json();
    const result = data.results[0];
    
    return {
      flagged: result.flagged,
      categories: result.categories,
      scores: result.category_scores,
    };
  }

  private async request(method: string, path: string, body?: unknown): Promise<Response> {
    const headers: Record<string, string> = {
      'Authorization': `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
    };
    
    if (this.organization) {
      headers['OpenAI-Organization'] = this.organization;
    }

    return fetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
  }
}

export function createOpenAIIntegration(config: IntegrationConfig): OpenAIIntegration {
  const integration = new OpenAIIntegration();
  integration.initialize(config);
  return integration;
}
