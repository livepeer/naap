/**
 * Pipeline Registry Interface
 *
 * Dynamic registry that discovers pipelines from go-livepeer at runtime.
 * No hardcoded pipeline names -- new pipelines auto-discovered.
 */

export interface ModelDescriptor {
  id: string;
  name: string;
  warm: boolean;
  price?: string;
}

export interface PricingInfo {
  model: string;
  pricePerUnit: string;
  unit: 'pixel' | 'token' | 'second' | 'request';
}

export interface PipelineDescriptor {
  /** Pipeline name (e.g., 'text-to-image', 'llm', 'custom-watermark') */
  name: string;

  /** Pipeline type: batch (request/response) or stream (trickle/WHIP) */
  type: 'batch' | 'stream';

  /** Available models with pricing */
  models: ModelDescriptor[];

  /** Input schema (from go-livepeer OpenAPI) */
  inputSchema?: Record<string, unknown>;

  /** Output schema */
  outputSchema?: Record<string, unknown>;

  /** Capability IDs */
  capabilities: number[];

  /** Pricing info per model */
  pricing: PricingInfo[];

  /** Source: built-in go-livepeer or BYOC */
  source: 'builtin' | 'byoc';
}

/**
 * Pipeline registry interface.
 * Implementations poll go-livepeer for available capabilities.
 */
export interface IPipelineRegistry {
  /** Discover available pipelines from go-livepeer */
  discover(): Promise<PipelineDescriptor[]>;

  /** Get a specific pipeline by name */
  get(pipeline: string): PipelineDescriptor | null;

  /** Get the input/output schema for a pipeline */
  getSchema(pipeline: string): Record<string, unknown> | null;

  /** Check if a pipeline is currently available */
  isAvailable(pipeline: string): boolean;

  /** Subscribe to capability changes */
  onCapabilitiesChanged(cb: (pipelines: PipelineDescriptor[]) => void): () => void;
}
