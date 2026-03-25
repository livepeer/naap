/**
 * Public Developer API response types.
 *
 * Shared across /api/v1/{network,orchestrators,gpus,capacity,pipelines,pricing}.
 * These are the stable, public-facing shapes — decoupled from internal
 * dashboard types so the public contract can evolve independently.
 */

// ---------------------------------------------------------------------------
// GET /api/v1/network
// ---------------------------------------------------------------------------

export interface NetworkSummary {
  timeframe_hours: number;
  success_rate: number;
  active_providers: number;
  usage_mins: number;
  sessions: number;
}

// ---------------------------------------------------------------------------
// GET /api/v1/orchestrators  &  GET /api/v1/orchestrators/[address]
// ---------------------------------------------------------------------------

export interface OrchestratorSummary {
  address: string;
  success_rate: number;
  sla_score: number | null;
  gpu_count: number;
  pipelines: string[];
  sessions: number;
}

export interface PipelineModelDetail {
  pipeline: string;
  models: string[];
}

export interface OrchestratorDetail extends OrchestratorSummary {
  pipeline_models: PipelineModelDetail[];
}

// ---------------------------------------------------------------------------
// GET /api/v1/gpus  &  GET /api/v1/capacity
// ---------------------------------------------------------------------------

export interface GPUHardwareEntry {
  model: string;
  count: number;
}

export interface PipelineGPUBreakdown {
  pipeline: string;
  gpu_count: number;
  by_model: Array<{ model: string; gpu_count: number }>;
}

export interface GPUSummary {
  total: number;
  hardware: GPUHardwareEntry[];
  by_pipeline: PipelineGPUBreakdown[];
}

export interface CapacitySummary {
  total_gpus: number;
  pipelines: PipelineGPUBreakdown[];
}

// ---------------------------------------------------------------------------
// GET /api/v1/pipelines
// ---------------------------------------------------------------------------

export interface PipelineEntry {
  id: string;
  capability: string;
  price_per_unit_wei: number;
  avg_pixels_per_unit: number | null;
}

// ---------------------------------------------------------------------------
// GET /api/v1/pricing
// Optional query: pipeline — matches capability (public `capability`) or model id (public `pipeline`).
// Optional query: model — matches public `pipeline` only (model / constraint id).
// When both are set, filters are combined (AND).
// ---------------------------------------------------------------------------

export interface PricingEntry {
  pipeline: string;
  capability: string;
  price_per_unit_wei: number;
  avg_pixels_per_unit: number | null;
}
