/**
 * SSE Streaming Handler
 *
 * Translates Livepeer LLM streaming chunks into OpenAI-format SSE events.
 */

import type { Response } from 'express';
import type { ChatCompletionChunk, ChatCompletionChunkChoice } from './types.js';
import type { LLMChunk } from '@naap/livepeer-node-client';

/**
 * Set up SSE headers on the response.
 */
export function initSSEHeaders(res: Response, requestId: string): void {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('x-request-id', requestId);
}

/**
 * Convert a Livepeer LLM chunk to an OpenAI-format chunk and write it as SSE.
 */
export function writeChunk(res: Response, requestId: string, model: string, chunk: LLMChunk): void {
  const choices: ChatCompletionChunkChoice[] = (chunk.choices || []).map((choice, index) => ({
    index,
    delta: { content: choice.delta?.content },
    finish_reason: choice.finish_reason as ChatCompletionChunkChoice['finish_reason'],
  }));

  const openaiChunk: ChatCompletionChunk = {
    id: `chatcmpl-${requestId}`,
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    model,
    choices,
  };

  res.write(`data: ${JSON.stringify(openaiChunk)}\n\n`);
}

/**
 * Write the initial SSE chunk with the assistant role.
 */
export function writeRoleChunk(res: Response, requestId: string, model: string): void {
  const chunk: ChatCompletionChunk = {
    id: `chatcmpl-${requestId}`,
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }],
  };
  res.write(`data: ${JSON.stringify(chunk)}\n\n`);
}

/**
 * Write the final [DONE] marker.
 */
export function writeDone(res: Response): void {
  res.write('data: [DONE]\n\n');
  res.end();
}
