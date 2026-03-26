/**
 * OpenAI-Compatible Adapter Module
 *
 * Exposes Livepeer AI pipelines through OpenAI's API format,
 * enabling registration as an OpenRouter provider.
 */

export { registerOpenAIRoutes } from './adapter.js';
export { resolveModel, listModels, isModelAvailable } from './models.js';
export type {
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatCompletionChunk,
  OpenAIModel,
  OpenAIModelList,
  OpenRouterModel,
  ModelMapping,
} from './types.js';
