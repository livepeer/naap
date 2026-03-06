/**
 * Leaderboard API — typed fetch wrappers
 *
 * Thin wrappers around the endpoints exposed by
 * livepeer-leaderboard-serverless. All functions return typed arrays
 * and throw on non-OK responses so callers can catch and fall back.
 *
 * Interval math (from clickhouse.go): start = end - interval * 12
 *   interval=1h  → 12 h lookback at 1 h resolution
 *   interval=2h  → 24 h lookback at 2 h resolution  (daily totals)
 *   interval=14h → 7 d  lookback at 14 h resolution (weekly fees)
 */

/** Use server proxy so requests use LEADERBOARD_API_URL, timeout, and path validation. */
const BASE_URL = '/api/v1/leaderboard';

// ---------------------------------------------------------------------------
// Response shapes (mirror models/metrics.go JSON tags)
// ---------------------------------------------------------------------------

export interface NetworkDemandRow {
  window_start: string;
  gateway: string;
  region: string | null;
  pipeline: string;
  model_id: string | null;
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
  gpu_name: string | null;
  gpu_memory_total: number | null;
}

export interface SLAComplianceRow {
  window_start: string;
  orchestrator_address: string;
  pipeline: string;
  model_id: string | null;
  gpu_id: string | null;
  known_sessions: number;
  success_sessions: number;
  unexcused_sessions: number;
  swapped_sessions: number;
  success_ratio: number | null;
  no_swap_ratio: number | null;
  sla_score: number | null;
}

export interface PipelineCatalogEntry {
  id: string;
  models: string[];
  regions: string[];
}

// ---------------------------------------------------------------------------
// Fetch helpers
// ---------------------------------------------------------------------------

async function apiFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`leaderboard API ${path} failed: ${res.status}`);
  return res.json() as Promise<T>;
}

export async function fetchNetworkDemand(lookbackHours: number): Promise<NetworkDemandRow[]> {
  if (!Number.isFinite(lookbackHours) || lookbackHours <= 0) {
    throw new Error(`fetchNetworkDemand: lookbackHours must be a finite number > 0, got ${lookbackHours}`);
  }
  // The API uses a quirk where it multiplies the interval by 12 to get the total lookback window.
  // We abstract that away here so callers can just ask for the total hours they want.
  const intervalMinutes = (lookbackHours * 60) / 12;
  const query = new URLSearchParams({ interval: `${intervalMinutes}m` });
  const data = await apiFetch<{ demand: NetworkDemandRow[] }>(
    `/network/demand?${query.toString()}`
  );
  return data.demand ?? [];
}

export async function fetchGPUMetrics(timeRange: string): Promise<GPUMetricRow[]> {
  const query = new URLSearchParams({ time_range: timeRange });
  const data = await apiFetch<{ metrics: GPUMetricRow[] }>(
    `/gpu/metrics?${query.toString()}`
  );
  return data.metrics ?? [];
}

export async function fetchSLACompliance(period: string): Promise<SLAComplianceRow[]> {
  const query = new URLSearchParams({ period });
  const data = await apiFetch<{ compliance: SLAComplianceRow[] }>(
    `/sla/compliance?${query.toString()}`
  );
  return data.compliance ?? [];
}

export async function fetchPipelineCatalog(): Promise<PipelineCatalogEntry[]> {
  const data = await apiFetch<{ pipelines: PipelineCatalogEntry[] }>('/pipelines');
  return data.pipelines ?? [];
}
