/**
 * Model Mapping Registry
 *
 * Maps OpenRouter model IDs to Livepeer pipeline configurations.
 * Phase 1: Static configuration. Phase 4 will add dynamic discovery.
 */

import type { ModelMapping, OpenRouterModel } from './types.js';

/**
 * Static model registry mapping OpenRouter IDs to Livepeer pipelines.
 * Models are registered with the "livepeer/" prefix per OpenRouter convention.
 */
const MODEL_REGISTRY: ModelMapping[] = [
  {
    openrouterId: 'livepeer/llama-3.1-8b-instruct',
    name: 'Llama 3.1 8B Instruct',
    pipeline: 'llm',
    livepeerModelId: 'meta-llama/Meta-Llama-3.1-8B-Instruct',
    contextLength: 131072,
    maxCompletionTokens: 4096,
    pricing: { prompt: '0.00006', completion: '0.00006' },
    description: 'Meta Llama 3.1 8B Instruct running on Livepeer decentralized GPU network',
  },
  {
    openrouterId: 'livepeer/llama-3.1-70b-instruct',
    name: 'Llama 3.1 70B Instruct',
    pipeline: 'llm',
    livepeerModelId: 'meta-llama/Meta-Llama-3.1-70B-Instruct',
    contextLength: 131072,
    maxCompletionTokens: 4096,
    pricing: { prompt: '0.00035', completion: '0.0004' },
    description: 'Meta Llama 3.1 70B Instruct running on Livepeer decentralized GPU network',
  },
];

/** Lookup by OpenRouter model ID */
const modelIndex = new Map<string, ModelMapping>();
for (const m of MODEL_REGISTRY) {
  modelIndex.set(m.openrouterId, m);
}

/**
 * Resolve an OpenRouter model ID to its Livepeer mapping.
 * Returns null if the model is not registered.
 */
export function resolveModel(openrouterId: string): ModelMapping | null {
  return modelIndex.get(openrouterId) ?? null;
}

/**
 * List all available models in OpenRouter-extended format.
 */
export function listModels(): OpenRouterModel[] {
  const now = Math.floor(Date.now() / 1000);
  return MODEL_REGISTRY.map((m) => ({
    id: m.openrouterId,
    object: 'model' as const,
    created: now,
    owned_by: 'livepeer',
    name: m.name,
    description: m.description,
    pricing: { prompt: m.pricing.prompt, completion: m.pricing.completion },
    context_length: m.contextLength,
    architecture: {
      modality: 'text->text',
      tokenizer: 'Llama3',
      instruct_type: 'llama3',
    },
    top_provider: {
      max_completion_tokens: m.maxCompletionTokens,
      is_moderated: false,
    },
  }));
}

/**
 * Check if a model ID is registered.
 */
export function isModelAvailable(openrouterId: string): boolean {
  return modelIndex.has(openrouterId);
}
