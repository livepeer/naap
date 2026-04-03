/**
 * Response Builder
 *
 * Converts Livepeer pipeline results into OpenAI chat/completions format.
 */

import type {
  ChatCompletionResponse,
  ChatCompletionChoice,
  UsageInfo,
} from './types.js';
import type { LLMResponse } from '@naap/livepeer-node-client';

/**
 * Build a chat completion response from a Livepeer LLM result.
 */
export function buildChatCompletion(
  requestId: string,
  model: string,
  llmResult: LLMResponse,
): ChatCompletionResponse {
  const choices: ChatCompletionChoice[] = (llmResult.choices || []).map((choice, index) => ({
    index,
    message: {
      role: 'assistant' as const,
      content: choice.message?.content ?? '',
    },
    finish_reason: normalizeFinishReason(choice.finish_reason),
  }));

  // Default to a single empty choice if none returned
  if (choices.length === 0) {
    choices.push({
      index: 0,
      message: { role: 'assistant', content: '' },
      finish_reason: 'stop',
    });
  }

  const usage: UsageInfo = llmResult.usage
    ? {
        prompt_tokens: llmResult.usage.prompt_tokens,
        completion_tokens: llmResult.usage.completion_tokens,
        total_tokens: llmResult.usage.total_tokens,
      }
    : { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };

  return {
    id: `chatcmpl-${requestId}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model,
    choices,
    usage,
  };
}

function normalizeFinishReason(reason: string | null | undefined): 'stop' | 'length' | 'content_filter' | null {
  if (!reason) return null;
  switch (reason) {
    case 'stop':
    case 'eos':
    case 'end_turn':
      return 'stop';
    case 'length':
    case 'max_tokens':
      return 'length';
    case 'content_filter':
      return 'content_filter';
    default:
      return 'stop';
  }
}
