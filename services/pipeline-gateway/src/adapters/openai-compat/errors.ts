/**
 * Error Translation
 *
 * Maps Livepeer pipeline errors to OpenAI-compatible error responses.
 */

import type { OpenAIError } from './types.js';

/**
 * Create an OpenAI-format error response.
 */
export function openAIError(
  message: string,
  type: string,
  code: string | null = null,
  param: string | null = null,
): OpenAIError {
  return { error: { message, type, param, code } };
}

/**
 * Translate a Livepeer/internal error into an OpenAI-format error with HTTP status.
 */
export function translateError(err: unknown): { status: number; body: OpenAIError } {
  const message = err instanceof Error ? err.message : String(err);

  // Model not found
  if (message.includes('not found') || message.includes('not available')) {
    return {
      status: 404,
      body: openAIError(
        `The model does not exist or you do not have access to it.`,
        'invalid_request_error',
        'model_not_found',
        'model',
      ),
    };
  }

  // Rate limiting
  if (message.includes('rate limit') || message.includes('too many requests')) {
    return {
      status: 429,
      body: openAIError(
        'Rate limit exceeded. Please retry after a brief wait.',
        'rate_limit_error',
        'rate_limit_exceeded',
      ),
    };
  }

  // Timeout
  if (message.includes('timeout') || message.includes('ETIMEDOUT')) {
    return {
      status: 504,
      body: openAIError(
        'The request timed out. Please try again.',
        'timeout_error',
        'timeout',
      ),
    };
  }

  // Pipeline disabled
  if (message.includes('disabled')) {
    return {
      status: 503,
      body: openAIError(
        'The model is temporarily unavailable.',
        'server_error',
        'model_unavailable',
      ),
    };
  }

  // Default: internal server error
  return {
    status: 500,
    body: openAIError(
      'An internal error occurred. Please retry your request.',
      'server_error',
      'internal_error',
    ),
  };
}
