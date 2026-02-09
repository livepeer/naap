/**
 * Versioned Pipeline Response Envelope
 *
 * All pipeline responses are wrapped in this stable envelope.
 * SDK hooks consume the stable envelope. The `result` field is typed
 * per-pipeline but plugins don't break if fields are added/removed.
 */

export interface PipelineResponseMetadata {
  /** Estimated cost in wei */
  cost: string;
  /** Processing time in ms */
  duration: number;
  /** Orchestrator that processed the request */
  orchestrator: string;
  /** Whether the result was served from cache */
  cached: boolean;
}

export interface PipelineResponse<T = unknown> {
  /** Envelope version for backward compatibility */
  version: '1.0';
  /** Pipeline name */
  pipeline: string;
  /** Model used */
  model: string;
  /** Request status */
  status: 'success' | 'pending' | 'error';
  /** Unique request ID */
  requestId: string;
  /** Pipeline-specific result data */
  result: T;
  /** Request metadata */
  metadata: PipelineResponseMetadata;
  /** Error details (only when status is 'error') */
  error?: { code: string; message: string };
}
