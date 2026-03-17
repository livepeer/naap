/**
 * Request Parser
 *
 * Translates OpenAI chat/completions requests into Livepeer pipeline parameters.
 */

import type { ChatCompletionRequest, ChatMessage, ContentPart } from './types.js';
import type { ModelMapping } from './types.js';
import type { LLMRequest } from '@naap/livepeer-node-client';

/**
 * Validate an incoming chat completion request.
 * Returns an error message string if invalid, or null if valid.
 */
export function validateRequest(body: unknown): string | null {
  if (!body || typeof body !== 'object') {
    return 'Request body must be a JSON object';
  }

  const req = body as Record<string, unknown>;

  if (!req.model || typeof req.model !== 'string') {
    return "'model' is required and must be a string";
  }

  if (!Array.isArray(req.messages) || req.messages.length === 0) {
    return "'messages' is required and must be a non-empty array";
  }

  for (const msg of req.messages) {
    if (!msg || typeof msg !== 'object') {
      return 'Each message must be an object';
    }
    if (!['system', 'user', 'assistant'].includes(msg.role)) {
      return `Invalid message role: '${msg.role}'`;
    }
    if (msg.content === undefined || msg.content === null) {
      return 'Each message must have a content field';
    }
  }

  if (req.temperature !== undefined) {
    const t = Number(req.temperature);
    if (isNaN(t) || t < 0 || t > 2) {
      return "'temperature' must be between 0 and 2";
    }
  }

  if (req.max_tokens !== undefined) {
    const mt = Number(req.max_tokens);
    if (isNaN(mt) || mt < 1) {
      return "'max_tokens' must be a positive integer";
    }
  }

  return null;
}

/**
 * Extract text content from a message, handling both string and content-part formats.
 */
function extractTextContent(message: ChatMessage): string {
  if (typeof message.content === 'string') {
    return message.content;
  }

  // Multi-part content: extract text parts
  return (message.content as ContentPart[])
    .filter((part) => part.type === 'text' && part.text)
    .map((part) => part.text!)
    .join('\n');
}

/**
 * Convert an OpenAI chat completion request to Livepeer LLM parameters.
 */
export function tolivepeerLLMRequest(req: ChatCompletionRequest, mapping: ModelMapping): LLMRequest {
  return {
    model: mapping.livepeerModelId,
    messages: req.messages.map((msg) => ({
      role: msg.role,
      content: extractTextContent(msg),
    })),
    max_tokens: req.max_tokens ?? mapping.maxCompletionTokens,
    temperature: req.temperature,
    stream: req.stream ?? false,
  };
}
