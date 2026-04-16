/**
 * Facade types not yet in @naap/plugin-sdk.
 *
 * Add types here as new data domains are added to the facade.
 * When a type matures it can be promoted to @naap/plugin-sdk.
 */

/** Single entry in the live job feed — from NAAP API /v1/dashboard/job-feed */
export interface JobFeedItem {
  id: string;
  pipeline: string;
  model?: string;
  gateway: string;
  orchestratorAddress?: string;
  orchestratorUrl: string;
  state: string;
  job_type?: string;
  inputFps: number;
  outputFps: number;
  firstSeen: string;
  lastSeen: string;
  durationSeconds?: number;
  runningFor?: string;
}

/** Row from NAAP API /v1/streaming/models */
export interface StreamingModel {
  pipeline: string;
  model: string;
  warm_orch_count: number;
  gpu_slots: number;
  active_streams: number;
  available_capacity: number;
  avg_fps: number;
}

/** Row from NAAP API /v1/requests/models */
export interface RequestsModel {
  pipeline: string;
  model: string;
  job_type: string;
  warm_orch_count: number;
  gpu_slots: number;
  job_count_24h: number;
  success_rate: number;
  avg_duration_ms: number;
}

/**
 * Unified network model for the developer/network-models page.
 * Mapped from streaming/models + requests/models endpoints.
 */
export interface NetworkModel {
  Pipeline: string;
  Model: string;
  WarmOrchCount: number;
  TotalCapacity: number;
  PriceMinWeiPerPixel: number;
  PriceMaxWeiPerPixel: number;
  PriceAvgWeiPerPixel: number;
}
