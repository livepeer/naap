/**
 * Leaderboard API typed fetch helpers for developer-api plugin.
 */

const BASE_URL = import.meta.env.VITE_LEADERBOARD_BASE_URL || '/api/v1/leaderboard';

export interface PipelineEntry {
  id: string;
  models: string[];
  regions: string[];
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
  gpu_memory_total: number | null;
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

async function apiFetch<T>(path: string): Promise<T> {
  const response = await fetch(`${BASE_URL}${path}`);
  if (!response.ok) {
    throw new Error(`leaderboard API ${path} failed: ${response.status}`);
  }
  return response.json() as Promise<T>;
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
  const data = await apiFetch<{ pipelines: PipelineEntry[] }>('/pipelines');
  return data.pipelines ?? [];
}

export async function fetchGPUMetrics(timeRange: string): Promise<GPUMetricRow[]> {
  const query = toQueryString({ time_range: timeRange });
  const data = await apiFetch<{ metrics: GPUMetricRow[] }>(`/gpu/metrics${query}`);
  return data.metrics ?? [];
}

export async function fetchSLACompliance(period: string): Promise<SLAComplianceRow[]> {
  const query = toQueryString({ period });
  const data = await apiFetch<{ compliance: SLAComplianceRow[] }>(`/sla/compliance${query}`);
  return data.compliance ?? [];
}
