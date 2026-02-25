/**
 * Leaderboard API — typed fetch wrappers for the Developer API Manager
 *
 * Calls https://leaderboard-api.livepeer.cloud directly from the browser,
 * following the same pattern as plugins/dashboard-provider-mock/frontend/src/api/leaderboard.ts
 */

const BASE_URL = 'https://leaderboard-api.livepeer.cloud';

// ---------------------------------------------------------------------------
// Response shapes
// ---------------------------------------------------------------------------

export interface PipelineEntry {
  id: string;
  models: string[];
  regions: string[];
}

export interface RegionEntry {
  id: string;
  name: string;
  type: string; // "transcoding" | "ai"
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
  jitter_coeff_fps: number | null;
  status_samples: number;
  gpu_name: string | null;
  gpu_memory_total: number | null; // bytes
  runner_version: string | null;
  cuda_version: string | null;
  prompt_to_first_frame_ms: number | null;
  startup_time_ms: number | null;
  startup_time_s: number | null;
  e2e_latency_ms: number | null;
  p95_prompt_to_first_frame_ms: number | null;
  p95_startup_time_ms: number | null;
  p95_e2e_latency_ms: number | null;
  valid_prompt_to_first_frame_count: number;
  valid_startup_time_count: number;
  valid_e2e_latency_count: number;
  known_sessions: number;
  success_sessions: number;
  excused_sessions: number;
  unexcused_sessions: number;
  failure_rate: number;
  swap_rate: number;
}

export interface SLAComplianceRow {
  window_start: string;
  orchestrator_address: string;
  pipeline: string;
  model_id: string | null;
  gpu_id: string | null;
  region: string | null;
  known_sessions: number;
  success_sessions: number;
  excused_sessions: number;
  unexcused_sessions: number;
  swapped_sessions: number;
  success_ratio: number | null;
  no_swap_ratio: number | null;
  sla_score: number | null;
}

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

export interface GPUMetricsFilters {
  orchestrator_address?: string;
  gpu_id?: string;
  region?: string;
  pipeline?: string;
  model_id?: string;
  gpu_name?: string;
  runner_version?: string;
  cuda_version?: string;
}

export interface SLAComplianceFilters {
  orchestrator_address?: string;
  region?: string;
  pipeline?: string;
  model_id?: string;
  gpu_id?: string;
}

export interface NetworkDemandFilters {
  gateway?: string;
  region?: string;
  pipeline?: string;
}

// ---------------------------------------------------------------------------
// Fetch helpers
// ---------------------------------------------------------------------------

async function apiFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`);
  if (!res.ok) throw new Error(`leaderboard API ${path} failed: ${res.status}`);
  return res.json() as Promise<T>;
}

function toQueryString(params: Record<string, string | undefined>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) query.set(key, value);
  }
  const encoded = query.toString();
  return encoded ? `?${encoded}` : '';
}

export async function fetchPipelines(): Promise<PipelineEntry[]> {
  const data = await apiFetch<{ pipelines: PipelineEntry[] }>('/api/pipelines');
  return data.pipelines ?? [];
}

export async function fetchRegions(): Promise<RegionEntry[]> {
  const data = await apiFetch<{ regions: RegionEntry[] }>('/api/regions');
  return (data.regions ?? []).filter((r) => r.type === 'ai');
}

export async function fetchGPUMetrics(
  timeRange: string,
  filters: GPUMetricsFilters = {}
): Promise<GPUMetricRow[]> {
  const query = toQueryString({
    time_range: timeRange,
    ...filters,
  });
  const data = await apiFetch<{ metrics: GPUMetricRow[] }>(
    `/api/gpu/metrics${query}`
  );
  return data.metrics ?? [];
}

export async function fetchSLACompliance(
  period: string,
  filters: SLAComplianceFilters = {}
): Promise<SLAComplianceRow[]> {
  const query = toQueryString({
    period,
    ...filters,
  });
  const data = await apiFetch<{ compliance: SLAComplianceRow[] }>(
    `/api/sla/compliance${query}`
  );
  return data.compliance ?? [];
}

export async function fetchNetworkDemand(
  interval: string,
  filters: NetworkDemandFilters = {}
): Promise<NetworkDemandRow[]> {
  const query = toQueryString({
    interval,
    ...filters,
  });
  const data = await apiFetch<{ demand: NetworkDemandRow[] }>(
    `/api/network/demand${query}`
  );
  return data.demand ?? [];
}
