/**
 * Livepeer Leaderboard API — Response Types
 *
 * These types mirror the JSON shapes returned by the leaderboard API
 * via the service gateway proxy.
 */

// ── /pipelines ───────────────────────────────────────────────────────────────

export interface Pipeline {
  id: string;
  models: string[];
  regions: string[];
}

export interface PipelinesResponse {
  pipelines: Pipeline[];
}

// ── /stats (aggregated) ──────────────────────────────────────────────────────

export interface AggregatedScore {
  success_rate: number;
  round_trip_score: number;
  score: number;
}

/**
 * Aggregated stats response: a map of orchestrator address -> region -> scores.
 * Example: { "0xabc...": { "SEA": { success_rate: 1, round_trip_score: 0.78, score: 0.92 } } }
 */
export type AggregatedStatsResponse = Record<
  string,
  Record<string, AggregatedScore>
>;

// ── /stats/raw ───────────────────────────────────────────────────────────────

export interface RawStatEntry {
  region: string;
  orchestrator: string;
  success_rate: number;
  round_trip_time: number;
  errors: string[];
  timestamp: number;
  model: string;
  model_is_warm: boolean;
  pipeline: string;
  input_parameters: string;
  response_payload: string;
}

export type RawStatsResponse = Record<string, RawStatEntry[]>;

// ── Derived / UI types ───────────────────────────────────────────────────────

export interface OrchestratorScore {
  address: string;
  region: string;
  successRate: number;
  roundTripScore: number;
  score: number;
  pipeline: string;
  model: string;
}

export interface PipelineSummary {
  id: string;
  modelCount: number;
  regions: string[];
  models: string[];
}

export interface KPIData {
  totalPipelines: number;
  totalModels: number;
  activeRegions: number;
  topScore: number;
}
