/**
 * LLM Gateway — Multi-provider, configurable LLM access.
 * Supports: Gemini, OpenAI, Claude, Kimi, MiniMax, and any future provider.
 * Adding a new provider = implement LLMProvider + register. Zero framework changes.
 */

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
  imageUrl?: string; // For vision models
}

export interface LLMRequest {
  messages: LLMMessage[];
  model?: string;          // Override specific model (e.g., "gemini-2.5-flash")
  tier?: 'fast' | 'standard' | 'premium'; // Maps to provider-specific models
  maxTokens?: number;
  temperature?: number;
  responseFormat?: 'text' | 'json';
  tenantId?: string;       // For usage tracking
}

export interface LLMResponse {
  content: string;
  model: string;
  provider: string;
  tokensUsed: { input: number; output: number };
  costCents: number;
  latencyMs: number;
}

export interface LLMProviderConfig {
  id: string;
  name: string;             // "Google Gemini", "OpenAI", "Anthropic Claude"
  provider: string;         // "gemini" | "openai" | "claude" | "kimi" | "minimax"
  apiKey: string;
  baseUrl?: string;         // For custom endpoints
  enabled: boolean;
  isDefault: boolean;
  models: {
    fast: string;           // Cheapest/fastest model
    standard: string;       // Balanced model
    premium: string;        // Most capable model
    vision?: string;        // Vision-capable model
  };
  rateLimit?: number;       // requests per minute
}

export interface LLMProvider {
  id: string;
  name: string;

  chat(request: LLMRequest, config: LLMProviderConfig): Promise<LLMResponse>;

  /** Check if this provider supports vision (image input) */
  supportsVision(): boolean;

  /** Estimate cost for a request (before sending) */
  estimateCost(inputTokens: number, outputTokens: number, model: string): number;
}
