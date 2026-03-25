/**
 * Orchestrator Leaderboard — Shared Types
 *
 * Types for the leaderboard API request/response, ClickHouse row mapping,
 * SLA weight configuration, and the in-memory cache.
 */

// ---------------------------------------------------------------------------
// API Request
// ---------------------------------------------------------------------------

export interface LeaderboardFilters {
  gpuRamGbMin?: number;
  gpuRamGbMax?: number;
  priceMax?: number;
  maxAvgLatencyMs?: number;
  maxSwapRatio?: number;
}

export interface SLAWeights {
  latency?: number;
  swapRate?: number;
  price?: number;
}

export interface LeaderboardRequest {
  capability: string;
  topN?: number;
  filters?: LeaderboardFilters;
  slaWeights?: SLAWeights;
}

// ---------------------------------------------------------------------------
// API Response
// ---------------------------------------------------------------------------

export interface OrchestratorRow {
  orchUri: string;
  gpuName: string;
  gpuGb: number;
  avail: number;
  totalCap: number;
  pricePerUnit: number;
  bestLatMs: number | null;
  avgLatMs: number | null;
  swapRatio: number | null;
  avgAvail: number | null;
  slaScore?: number;
}

// ---------------------------------------------------------------------------
// ClickHouse JSON Response Mapping
// ---------------------------------------------------------------------------

export interface ClickHouseLeaderboardRow {
  orch_uri: string;
  gpu_name: string;
  gpu_gb: number;
  avail: number;
  total_cap: number;
  price_per_unit: number;
  best_lat_ms: number | null;
  avg_lat_ms: number | null;
  swap_ratio: number | null;
  avg_avail: number | null;
}

export interface ClickHouseJSONResponse {
  meta: Array<{ name: string; type: string }>;
  data: ClickHouseLeaderboardRow[];
  rows: number;
  statistics: { elapsed: number; rows_read: number; bytes_read: number };
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

export interface CacheEntry<T> {
  data: T;
  cachedAt: number;
  expiresAt: number;
}
