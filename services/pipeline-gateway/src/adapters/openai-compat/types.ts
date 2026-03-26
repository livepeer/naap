/**
 * OpenAI-Compatible API Types
 *
 * TypeScript interfaces for OpenAI chat/completions API format,
 * used to expose Livepeer pipelines through OpenRouter.
 */

// ─── Request Types ──────────────────────────────────────────────────────────

export interface ChatCompletionRequest {
  model: string;
  messages: ChatMessage[];
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
  stream?: boolean;
  stop?: string | string[];
  frequency_penalty?: number;
  presence_penalty?: number;
  n?: number;
  user?: string;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | ContentPart[];
}

export interface ContentPart {
  type: 'text' | 'image_url';
  text?: string;
  image_url?: { url: string; detail?: 'low' | 'high' | 'auto' };
}

// ─── Response Types ─────────────────────────────────────────────────────────

export interface ChatCompletionResponse {
  id: string;
  object: 'chat.completion';
  created: number;
  model: string;
  choices: ChatCompletionChoice[];
  usage: UsageInfo;
}

export interface ChatCompletionChoice {
  index: number;
  message: { role: 'assistant'; content: string };
  finish_reason: 'stop' | 'length' | 'content_filter' | null;
}

export interface UsageInfo {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

// ─── Streaming Types ────────────────────────────────────────────────────────

export interface ChatCompletionChunk {
  id: string;
  object: 'chat.completion.chunk';
  created: number;
  model: string;
  choices: ChatCompletionChunkChoice[];
}

export interface ChatCompletionChunkChoice {
  index: number;
  delta: { role?: 'assistant'; content?: string };
  finish_reason: 'stop' | 'length' | 'content_filter' | null;
}

// ─── Model Listing Types ────────────────────────────────────────────────────

export interface OpenAIModel {
  id: string;
  object: 'model';
  created: number;
  owned_by: string;
}

export interface OpenAIModelList {
  object: 'list';
  data: OpenAIModel[];
}

// ─── OpenRouter Extended Model Types ────────────────────────────────────────

export interface OpenRouterModel extends OpenAIModel {
  name: string;
  description: string;
  pricing: { prompt: string; completion: string; image?: string; request?: string };
  context_length: number;
  architecture: { modality: string; tokenizer: string; instruct_type: string | null };
  top_provider: { max_completion_tokens: number | null; is_moderated: boolean };
}

// ─── Error Types ────────────────────────────────────────────────────────────

export interface OpenAIError {
  error: {
    message: string;
    type: string;
    param: string | null;
    code: string | null;
  };
}

// ─── Internal Mapping Types ─────────────────────────────────────────────────

export type LivepeerPipelineType = 'llm' | 'text-to-image' | 'image-to-text' | 'audio-to-text' | 'text-to-speech';

export interface ModelMapping {
  /** OpenRouter model ID (e.g., "livepeer/llama-3.1-8b") */
  openrouterId: string;
  /** Display name */
  name: string;
  /** Livepeer pipeline to delegate to */
  pipeline: LivepeerPipelineType;
  /** Livepeer model_id to pass to the pipeline */
  livepeerModelId: string;
  /** Context window size (for LLMs) */
  contextLength: number;
  /** Max completion tokens */
  maxCompletionTokens: number;
  /** Pricing per million tokens (USD string) */
  pricing: { prompt: string; completion: string };
  /** Description for model listing */
  description: string;
}
