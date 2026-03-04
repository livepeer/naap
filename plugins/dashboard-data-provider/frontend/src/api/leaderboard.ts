/**
 * Leaderboard API — typed fetch wrappers
 *
 * Thin wrappers around the three real endpoints exposed by
 * livepeer-leaderboard-serverless. All functions return typed arrays
 * and throw on non-OK responses so callers can catch and fall back.
 *
 * Interval math (from clickhouse.go): start = end - interval * 12
 *   interval=1h  → 12 h lookback at 1 h resolution
 *   interval=2h  → 24 h lookback at 2 h resolution  (daily totals)
 *   interval=14h → 7 d  lookback at 14 h resolution (weekly fees)
 */

const BASE_URL = 'https://leaderboard-api.livepeer.cloud';

// ---------------------------------------------------------------------------
// Response shapes (mirror models/metrics.go JSON tags)
// ---------------------------------------------------------------------------

export interface NetworkDemandRow {
  window_start: string;
  gateway: string;
  region: string | null;
  pipeline: string;
  total_sessions: number;
  total_streams: number;
  avg_output_fps: number;
  total_inference_minutes: number;
  known_sessions: number;
  served_sessions: number;
  unserved_sessions: number;
  total_demand_sessions: number;
  unexcused_sessions: number;
  swapped_sessions: number;
  missing_capacity_count: number;
  success_ratio: number;
  fee_payment_eth: number;
}

export interface GPUMetricRow {
  window_start: string;
  orchestrator_address: string;
  pipeline: string;
  model_id: string | null;
  gpu_id: string | null;
  region: string | null;
  avg_output_fps: number;
  p95_output_fps: number;
  known_sessions: number;
  success_sessions: number;
  failure_rate: number;
  swap_rate: number;
}

export interface SLAComplianceRow {
  window_start: string;
  orchestrator_address: string;
  pipeline: string;
  gpu_id: string | null;
  known_sessions: number;
  success_sessions: number;
  success_ratio: number | null;
  no_swap_ratio: number | null;
  sla_score: number | null;
}

// ---------------------------------------------------------------------------
// Fetch helpers
// ---------------------------------------------------------------------------

async function apiFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`);
  if (!res.ok) throw new Error(`leaderboard API ${path} failed: ${res.status}`);
  return res.json() as Promise<T>;
}

export async function fetchNetworkDemand(interval: string): Promise<NetworkDemandRow[]> {
  const data = await apiFetch<{ demand: NetworkDemandRow[] }>(
    `/api/network/demand?interval=${interval}`
  );
  return data.demand ?? [];
}

export async function fetchGPUMetrics(timeRange: string): Promise<GPUMetricRow[]> {
  const data = await apiFetch<{ metrics: GPUMetricRow[] }>(
    `/api/gpu/metrics?time_range=${timeRange}`
  );
  return data.metrics ?? [];
}

export async function fetchSLACompliance(period: string): Promise<SLAComplianceRow[]> {
  const data = await apiFetch<{ compliance: SLAComplianceRow[] }>(
    `/api/sla/compliance?period=${period}`
  );
  return data.compliance ?? [];
}
