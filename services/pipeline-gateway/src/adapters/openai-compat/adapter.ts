/**
 * OpenAI-Compatible Adapter (Phase 1 - Issue #203)
 *
 * Core translation layer between OpenAI's chat/completions API format
 * and Livepeer's existing pipeline adapters. Enables Livepeer to be
 * registered as an OpenRouter provider.
 *
 * Endpoints:
 *   POST /v1/chat/completions  - Chat completions (streaming + non-streaming)
 *   GET  /v1/models            - List available models
 */

import type { Router, Request, Response } from 'express';
import type { LivepeerAIClient } from '@naap/livepeer-node-client';
import type { ChatCompletionRequest } from './types.js';
import { resolveModel, listModels } from './models.js';
import { validateRequest, tolivepeerLLMRequest } from './request-parser.js';
import { buildChatCompletion } from './response-builder.js';
import { initSSEHeaders, writeChunk, writeRoleChunk, writeDone } from './streaming.js';
import { openAIError, translateError } from './errors.js';

/**
 * Register OpenAI-compatible routes on the given Express router.
 *
 * Routes are mounted under /v1 to match OpenAI's API path convention:
 *   GET  /v1/models
 *   POST /v1/chat/completions
 */
export function registerOpenAIRoutes(router: Router, aiClient: LivepeerAIClient): void {
  // ─── GET /v1/models ──────────────────────────────────────────────────────

  router.get('/v1/models', (_req: Request, res: Response) => {
    const models = listModels();
    res.json({ object: 'list', data: models });
  });

  // ─── GET /v1/models/:model ───────────────────────────────────────────────

  router.get('/v1/models/:model(*)', (req: Request, res: Response) => {
    const mapping = resolveModel(req.params.model);
    if (!mapping) {
      return res.status(404).json(
        openAIError(`Model '${req.params.model}' not found`, 'invalid_request_error', 'model_not_found', 'model'),
      );
    }

    const models = listModels();
    const model = models.find((m) => m.id === mapping.openrouterId);
    res.json(model);
  });

  // ─── POST /v1/chat/completions ───────────────────────────────────────────

  router.post('/v1/chat/completions', async (req: Request, res: Response) => {
    const requestId = (req.headers['x-request-id'] as string) || crypto.randomUUID();

    // Validate request format
    const validationError = validateRequest(req.body);
    if (validationError) {
      return res.status(400).json(
        openAIError(validationError, 'invalid_request_error', 'invalid_request'),
      );
    }

    const body = req.body as ChatCompletionRequest;

    // Resolve model mapping
    const mapping = resolveModel(body.model);
    if (!mapping) {
      return res.status(404).json(
        openAIError(
          `The model '${body.model}' does not exist or is not available through Livepeer.`,
          'invalid_request_error',
          'model_not_found',
          'model',
        ),
      );
    }

    // Currently only LLM pipeline is supported for chat/completions
    if (mapping.pipeline !== 'llm') {
      return res.status(400).json(
        openAIError(
          `Model '${body.model}' does not support chat completions.`,
          'invalid_request_error',
          'unsupported_model',
          'model',
        ),
      );
    }

    try {
      const llmRequest = tolivepeerLLMRequest(body, mapping);

      if (body.stream) {
        await handleStream(res, requestId, body.model, llmRequest, aiClient);
      } else {
        await handleNonStream(res, requestId, body.model, llmRequest, aiClient);
      }
    } catch (err) {
      const { status, body: errorBody } = translateError(err);
      if (!res.headersSent) {
        res.status(status).json(errorBody);
      }
    }
  });
}

async function handleNonStream(
  res: Response,
  requestId: string,
  model: string,
  llmRequest: Parameters<LivepeerAIClient['llm']>[0],
  aiClient: LivepeerAIClient,
): Promise<void> {
  const result = await aiClient.llm(llmRequest);
  const response = buildChatCompletion(requestId, model, result);
  res.json(response);
}

async function handleStream(
  res: Response,
  requestId: string,
  model: string,
  llmRequest: Parameters<LivepeerAIClient['llm']>[0],
  aiClient: LivepeerAIClient,
): Promise<void> {
  initSSEHeaders(res, requestId);
  writeRoleChunk(res, requestId, model);

  try {
    for await (const chunk of aiClient.llmStream(llmRequest)) {
      writeChunk(res, requestId, model, chunk);
    }
    writeDone(res);
  } catch (err) {
    // If headers already sent, write error as SSE event
    const message = err instanceof Error ? err.message : String(err);
    res.write(`data: ${JSON.stringify({ error: { message, type: 'server_error' } })}\n\n`);
    res.end();
  }
}
