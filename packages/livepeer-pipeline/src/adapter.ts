/**
 * Pipeline Adapter Interface
 *
 * Each pipeline type implements this. Adding a new pipeline type = one adapter file.
 * No changes to gateway core or other adapters.
 */

import type { PipelineDescriptor } from './registry.js';

export interface PipelineContext {
  /** NaaP user ID */
  userId: string;
  /** Team ID if in team context */
  teamId?: string;
  /** Request ID for tracing */
  requestId: string;
  /** Trace ID for distributed tracing */
  traceId: string;
}

export interface PipelineRequest {
  /** Pipeline name (e.g., 'text-to-image', 'llm') */
  pipeline: string;
  /** Model ID to use */
  model?: string;
  /** Input data -- structure depends on pipeline type */
  input: unknown;
  /** Additional parameters */
  params?: Record<string, unknown>;
}

export interface PipelineResult {
  /** Pipeline-specific result data */
  data: unknown;
  /** Processing duration in ms */
  duration: number;
  /** Orchestrator that processed the request */
  orchestrator?: string;
  /** Whether result was served from cache */
  cached: boolean;
}

export interface StreamRequest {
  /** Pipeline name */
  pipeline: string;
  /** Model ID */
  model?: string;
  /** Stream parameters */
  params: Record<string, unknown>;
}

export interface StreamSession {
  /** Unique session/stream ID */
  streamId: string;
  /** WHIP publish URL */
  publishUrl?: string;
  /** WHEP subscribe URL */
  subscribeUrl?: string;
  /** Trickle control URL */
  controlUrl?: string;
  /** Events URL (SSE) */
  eventsUrl?: string;
}

export interface ValidationResult {
  valid: boolean;
  errors?: string[];
}

/**
 * Pipeline adapter interface.
 * Each pipeline type (batch, stream, LLM, live-video, BYOC) implements this.
 */
export interface IPipelineAdapter {
  /** Adapter name (e.g., 'batch-ai', 'llm-stream', 'live-video') */
  name: string;

  /** Adapter type */
  type: 'batch' | 'stream';

  /** Check if this adapter can handle a given pipeline descriptor */
  canHandle(pipeline: PipelineDescriptor): boolean;

  /** Execute a batch pipeline request */
  execute?(req: PipelineRequest, ctx: PipelineContext): Promise<PipelineResult>;

  /** Start a streaming session */
  startStream?(req: StreamRequest, ctx: PipelineContext): Promise<StreamSession>;

  /** Validate input against pipeline schema */
  validate?(input: unknown, pipeline: PipelineDescriptor): ValidationResult;

  /** Transform the result before wrapping in envelope */
  transformResult?(result: unknown, ctx: PipelineContext): unknown;
}
