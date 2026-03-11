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
  // Keys/Dimensions
  window_start: string;
  gateway: string;
  region: string | null;
  pipeline_id: string;
  model_id: string | null;
  // Demand/Capacity
  sessions_count: number;
  total_minutes: number;
  known_sessions_count: number;
  served_sessions: number;
  unserved_sessions: number;
  total_demand_sessions: number;
  // Reliability
  startup_unexcused_sessions: number;
  confirmed_swapped_sessions: number;
  inferred_swap_sessions: number;
  total_swapped_sessions: number;
  sessions_ending_in_error: number;
  error_status_samples: number;
  health_signal_coverage_ratio: number;
  startup_success_rate: number;
  effective_success_rate: number;
  // Economics
  ticket_face_value_eth: number;
}

export interface GPUMetricRow {
  // Keys/Dimensions
  window_start: string;
  orchestrator_address: string;
  pipeline_id: string;
  model_id: string | null;
  gpu_id: string | null;
  region: string | null;
  gpu_model_name: string | null;
  gpu_memory_bytes_total: number | null;
  runner_version: string | null;
  cuda_version: string | null;
  // Performance/Latency
  avg_output_fps: number;
  p95_output_fps: number;
  fps_jitter_coefficient: number | null;
  avg_prompt_to_first_frame_ms: number | null;
  avg_startup_latency_ms: number | null;
  avg_e2e_latency_ms: number | null;
  p95_prompt_to_first_frame_latency_ms: number | null;
  p95_startup_latency_ms: number | null;
  p95_e2e_latency_ms: number | null;
  // Valid Counts
  prompt_to_first_frame_sample_count: number;
  startup_latency_sample_count: number;
  e2e_latency_sample_count: number;
  status_samples: number;
  error_status_samples: number;
  // Reliability
  known_sessions_count: number;
  startup_success_sessions: number;
  startup_excused_sessions: number;
  startup_unexcused_sessions: number;
  confirmed_swapped_sessions: number;
  inferred_swap_sessions: number;
  total_swapped_sessions: number;
  sessions_ending_in_error: number;
  health_signal_coverage_ratio: number;
  // Rates
  startup_unexcused_rate: number;
  swap_rate: number;
}

export interface SLAComplianceRow {
  // Keys/Dimensions
  window_start: string;
  orchestrator_address: string;
  pipeline_id: string;
  model_id: string | null;
  gpu_id: string | null;
  region: string | null;
  // Reliability
  known_sessions_count: number;
  startup_success_sessions: number;
  startup_excused_sessions: number;
  startup_unexcused_sessions: number;
  confirmed_swapped_sessions: number;
  inferred_swap_sessions: number;
  total_swapped_sessions: number;
  sessions_ending_in_error: number;
  error_status_samples: number;
  health_signal_coverage_ratio: number;
  startup_success_rate: number | null;
  // SLA Scores
  effective_success_rate: number | null;
  no_swap_rate: number | null;
  sla_score: number | null;
}

export interface PipelineCatalogEntry {
  id: string;
  models: string[];
  regions: string[];
}

// ---------------------------------------------------------------------------
// Filter interfaces (match documented API params)
// ---------------------------------------------------------------------------

export interface NetworkDemandFilters {
  /** Aggregation interval duration (e.g. "15m", "1h"). Default "15m". */
  interval?: string;
  /** Optional gateway filter */
  gateway?: string;
  /** Optional region filter */
  region?: string;
  /** Optional pipeline filter */
  pipeline_id?: string;
  /** Optional model filter */
  model_id?: string;
}

export interface GPUMetricsFilters {
  /** Duration window to query (e.g. "1h", "24h"). Default "1h". */
  time_range?: string;
  /** Optional orchestrator address filter */
  orchestrator_address?: string;
  /** Optional pipeline filter */
  pipeline_id?: string;
  /** Optional model filter */
  model_id?: string;
  /** Optional GPU ID filter */
  gpu_id?: string;
  /** Optional region filter */
  region?: string;
  /** Optional GPU model name filter */
  gpu_model_name?: string;
  /** Optional runner version filter */
  runner_version?: string;
  /** Optional CUDA version filter */
  cuda_version?: string;
}

export interface SLAComplianceFilters {
  /** Duration window to query (e.g. "24h", "7d"). Default "24h". API supports up to 30d. */
  period?: string;
  /** Optional orchestrator address filter */
  orchestrator_address?: string;
  /** Optional pipeline filter */
  pipeline_id?: string;
  /** Optional model filter */
  model_id?: string;
  /** Optional GPU ID filter */
  gpu_id?: string;
  /** Optional region filter */
  region?: string;
}

export interface PipelineCatalogFilters {
  /** Optional region filter */
  region?: string;
  /** Optional since timestamp */
  since?: string;
  /** Optional until timestamp */
  until?: string;
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

/** Build URLSearchParams from filter object, omitting undefined/null values */
function buildParams<T extends object>(filters: T): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value != null && value !== '') {
      params.set(key, String(value));
    }
  }
  return params;
}

/**
 * Fetch network demand data with API-native filters.
 * For backward compatibility with optimized resolvers, also accepts lookbackHours as first arg.
 */
export async function fetchNetworkDemand(filtersOrLookbackHours: NetworkDemandFilters | number): Promise<NetworkDemandRow[]> {
  let filters: NetworkDemandFilters;

  if (typeof filtersOrLookbackHours === 'number') {
    // Backward compat: convert lookbackHours to interval
    const lookbackHours = filtersOrLookbackHours;
    if (!Number.isFinite(lookbackHours) || lookbackHours <= 0) {
      throw new Error(`fetchNetworkDemand: lookbackHours must be a finite number > 0, got ${lookbackHours}`);
    }
    // The API uses a quirk where it multiplies the interval by 12 to get the total lookback window.
    const intervalMinutes = (lookbackHours * 60) / 12;
    filters = { interval: `${intervalMinutes}m` };
  } else {
    filters = filtersOrLookbackHours;
  }

  const params = buildParams(filters);
  const data = await apiFetch<{ demand: NetworkDemandRow[] }>(
    `/network/demand?${params.toString()}`
  );
  return data.demand ?? [];
}

/**
 * Fetch GPU metrics data with API-native filters.
 * For backward compatibility, also accepts timeRange string as first arg.
 */
export async function fetchGPUMetrics(filtersOrTimeRange: GPUMetricsFilters | string): Promise<GPUMetricRow[]> {
  const filters: GPUMetricsFilters = typeof filtersOrTimeRange === 'string'
    ? { time_range: filtersOrTimeRange }
    : filtersOrTimeRange;

  const params = buildParams(filters);
  const data = await apiFetch<{ metrics: GPUMetricRow[] }>(
    `/gpu/metrics?${params.toString()}`
  );
  return data.metrics ?? [];
}

/**
 * Fetch SLA compliance data with API-native filters.
 * For backward compatibility, also accepts period string as first arg.
 */
export async function fetchSLACompliance(filtersOrPeriod: SLAComplianceFilters | string): Promise<SLAComplianceRow[]> {
  const filters: SLAComplianceFilters = typeof filtersOrPeriod === 'string'
    ? { period: filtersOrPeriod }
    : filtersOrPeriod;

  const params = buildParams(filters);
  const data = await apiFetch<{ compliance: SLAComplianceRow[] }>(
    `/sla/compliance?${params.toString()}`
  );
  return data.compliance ?? [];
}

/**
 * Fetch pipeline catalog with optional filters.
 */
export async function fetchPipelineCatalog(filters?: PipelineCatalogFilters): Promise<PipelineCatalogEntry[]> {
  const params = filters ? buildParams(filters) : new URLSearchParams();
  const queryString = params.toString();
  const path = queryString ? `/pipelines?${queryString}` : '/pipelines';
  const data = await apiFetch<{ pipelines: PipelineCatalogEntry[] }>(path);
  return data.pipelines ?? [];
}
