/**
 * LLM Stream Adapter (Phase 5b)
 *
 * Handles LLM requests with SSE streaming support.
 * Proxies to go-livepeer /llm endpoint, pipes Server-Sent Events.
 * Supports both streaming and non-streaming modes.
 */

import type { Response } from 'express';
import type { LivepeerAIClient } from '@naap/livepeer-node-client';
import type { IPipelineAdapter, PipelineDescriptor } from '@naap/livepeer-pipeline';
import type { PipelineContext, PipelineResult } from './BatchAIAdapter.js';

export class LLMStreamAdapter implements IPipelineAdapter {
  readonly name = 'llm-stream';
  readonly type = 'stream' as const;

  constructor(private aiClient: LivepeerAIClient) {}

  canHandle(pipeline: PipelineDescriptor): boolean {
    return pipeline.name === 'llm';
  }

  /** Non-streaming LLM execution */
  async execute(input: unknown, ctx: PipelineContext): Promise<PipelineResult> {
    const body = input as Record<string, unknown>;
    const model = (body.model_id as string) || (body.model as string) || 'default';

    const result = await this.aiClient.llm(body as Parameters<LivepeerAIClient['llm']>[0]);
    return { result, model, orchestrator: 'auto' };
  }

  /** Streaming LLM execution via SSE */
  async executeStream(input: unknown, res: Response, ctx: PipelineContext): Promise<void> {
    const body = input as Record<string, unknown>;

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('x-request-id', ctx.requestId);

    try {
      let tokenCount = 0;

      for await (const chunk of this.aiClient.llmStream(body as Parameters<LivepeerAIClient['llmStream']>[0])) {
        tokenCount++;
        res.write(`data: ${JSON.stringify(chunk)}\n\n`);
      }

      // Final metadata event
      res.write(`data: ${JSON.stringify({ __meta: { tokens: tokenCount, duration: Date.now() - ctx.startTime } })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
    } catch (err) {
      res.write(`data: ${JSON.stringify({ error: err instanceof Error ? err.message : String(err) })}\n\n`);
      res.end();
    }
  }
}
