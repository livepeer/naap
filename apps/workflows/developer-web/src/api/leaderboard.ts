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
  gpu_name: string | null;
  gpu_memory_total: number | null; // bytes
  e2e_latency_ms: number | null;
  p95_e2e_latency_ms: number | null;
  known_sessions: number;
  success_sessions: number;
  failure_rate: number;
  swap_rate: number;
}

export interface SLAComplianceRow {
  window_start: string;
  orchestrator_address: string;
  pipeline: string;
  model_id: string | null;
  gpu_id: string | null;
  known_sessions: number;
  success_sessions: number;
  success_ratio: number | null;
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

export async function fetchPipelines(): Promise<PipelineEntry[]> {
  const data = await apiFetch<{ pipelines: PipelineEntry[] }>('/api/pipelines');
  return data.pipelines ?? [];
}

export async function fetchRegions(): Promise<RegionEntry[]> {
  const data = await apiFetch<{ regions: RegionEntry[] }>('/api/regions');
  return (data.regions ?? []).filter((r) => r.type === 'ai');
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
