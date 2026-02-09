/**
 * Batch AI Adapter (Phase 5b)
 *
 * Handles all simple batch AI pipelines:
 * text-to-image, image-to-image, upscale, audio-to-text,
 * segment-anything-2, image-to-text, text-to-speech
 *
 * New pipelines of this pattern auto-work with zero code change.
 */

import type { LivepeerAIClient } from '@naap/livepeer-node-client';
import type { IPipelineAdapter, PipelineDescriptor } from '@naap/livepeer-pipeline';

export interface PipelineContext {
  requestId: string;
  userId?: string;
  startTime: number;
}

export interface PipelineResult {
  result: unknown;
  model: string;
  orchestrator: string;
}

const BATCH_PIPELINES = new Set([
  'text-to-image',
  'image-to-image',
  'upscale',
  'audio-to-text',
  'segment-anything-2',
  'image-to-text',
  'text-to-speech',
]);

export class BatchAIAdapter implements IPipelineAdapter {
  readonly name = 'batch-ai';
  readonly type = 'batch' as const;

  constructor(private aiClient: LivepeerAIClient) {}

  canHandle(pipeline: PipelineDescriptor): boolean {
    return pipeline.type === 'batch' || BATCH_PIPELINES.has(pipeline.name);
  }

  async execute(input: unknown, ctx: PipelineContext): Promise<PipelineResult> {
    const body = input as Record<string, unknown>;
    const pipelineName = body.__pipeline as string;
    delete body.__pipeline;

    let result: unknown;
    const model = (body.model_id as string) || 'default';

    switch (pipelineName) {
      case 'text-to-image':
        result = await this.aiClient.textToImage(body as Parameters<LivepeerAIClient['textToImage']>[0]);
        break;
      case 'image-to-image':
        result = await this.aiClient.imageToImage(body.image as File, body as Parameters<LivepeerAIClient['imageToImage']>[1]);
        break;
      case 'upscale':
        result = await this.aiClient.upscale(body.image as File, body as Parameters<LivepeerAIClient['upscale']>[1]);
        break;
      case 'audio-to-text':
        result = await this.aiClient.audioToText(body.audio as File, body as Parameters<LivepeerAIClient['audioToText']>[1]);
        break;
      case 'segment-anything-2':
        result = await this.aiClient.segmentAnything2(body.image as File, body as Parameters<LivepeerAIClient['segmentAnything2']>[1]);
        break;
      case 'image-to-text':
        result = await this.aiClient.imageToText(body.image as File, body as Parameters<LivepeerAIClient['imageToText']>[1]);
        break;
      case 'text-to-speech':
        result = await this.aiClient.textToSpeech(body as Parameters<LivepeerAIClient['textToSpeech']>[0]);
        break;
      default:
        // Generic capability request for auto-discovered batch pipelines
        result = await this.aiClient.processRequest(pipelineName, body);
    }

    return { result, model, orchestrator: 'auto' };
  }
}
