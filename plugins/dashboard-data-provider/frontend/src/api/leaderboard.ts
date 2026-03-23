/**
 * Leaderboard API — typed fetch wrappers
 *
 * Thin wrappers around the endpoints exposed by
 * livepeer-leaderboard-serverless. All functions return typed arrays
 * and throw on non-OK responses so callers can catch and fall back.
 *
 * All time-based endpoints use `window` query param (e.g. "24h", "7d", "30d"):
 *
 * Existing endpoints (probe/orchestrator data):
 *   /network/demand      – default 3h,  min 30m, max 30d
 *   /gpu/metrics         – default 24h, min 1h,  max 72h
 *   /sla/compliance      – default 24h, min 1h,  max 30d
 *
 * NaaP Platform Analytics (real production streaming events):
 *   /platform/pipelines  – default 24h, min 1h,  max 30d  → session count, success rate, minutes per pipeline
 *   /scope/performance   – default 24h, min 1h,  max 30d  → Scope GPU session FPS/TTFF metrics
 *   /gpu/capabilities    – default 24h, min 1h,  max 7d   → orchestrator capability/pricing snapshot
 */

/** Use server proxy so requests use LEADERBOARD_API_URL, timeout, and path validation. */
const BASE_URL = '/api/v1/leaderboard';
const LEADERBOARD_CLIENT_TIMEOUT_MS = 60_000;
const LEADERBOARD_RESPONSE_CACHE_TTL_MS = 60_000;

type CacheEntry = {
  expiresAt: number;
  data: unknown;
};

const responseCache = new Map<string, CacheEntry>();
const inFlightRequests = new Map<string, Promise<unknown>>();

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
  avg_output_fps: number;
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
  /** Duration window to query (e.g. "3h", "24h", "7d"). Default "3h", max "30d". */
  window?: string;
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
  /** Duration window to query (e.g. "1h", "24h", "72h"). Default "24h", max "72h". */
  window?: string;
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

interface PaginationInfo {
  page?: number;
  page_size?: number;
  total_count?: number;
  total_pages?: number;
}

export interface SLAComplianceFilters {
  /** Duration window to query (e.g. "24h", "7d", "720h"). Default "24h", max "30d" (720h), min 1h. */
  window?: string;
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
  const url = `${BASE_URL}${path}`;
  const now = Date.now();

  const cached = responseCache.get(url);
  if (cached && cached.expiresAt > now) {
    return cached.data as T;
  }
  if (cached) {
    responseCache.delete(url);
  }

  const inFlight = inFlightRequests.get(url);
  if (inFlight) {
    return inFlight as Promise<T>;
  }

  const requestPromise = (async (): Promise<T> => {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(LEADERBOARD_CLIENT_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`leaderboard API ${path} failed: ${res.status}`);

    const data = await res.json() as T;
    responseCache.set(url, {
      expiresAt: Date.now() + LEADERBOARD_RESPONSE_CACHE_TTL_MS,
      data,
    });
    return data;
  })().finally(() => {
    inFlightRequests.delete(url);
  });

  inFlightRequests.set(url, requestPromise);
  return requestPromise;
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
    const lookbackHours = filtersOrLookbackHours;
    if (!Number.isFinite(lookbackHours) || lookbackHours <= 0) {
      throw new Error(`fetchNetworkDemand: lookbackHours must be a finite number > 0, got ${lookbackHours}`);
    }
    filters = { window: `${lookbackHours}h` };
  } else {
    filters = filtersOrLookbackHours;
  }

  const pageSize = 500;
  const firstPageParams = buildParams({
    ...filters,
    page: 1,
    page_size: pageSize,
  });
  const firstPage = await apiFetch<{ demand: NetworkDemandRow[]; pagination?: PaginationInfo }>(
    `/network/demand?${firstPageParams.toString()}`
  );

  const allDemand: NetworkDemandRow[] = [...(firstPage.demand ?? [])];
  const reportedTotalPages = firstPage.pagination?.total_pages;
  const totalPages = Number.isFinite(reportedTotalPages) && (reportedTotalPages ?? 0) > 0
    ? Number(reportedTotalPages)
    : 1;

  if (totalPages <= 1) return allDemand;

  const pageBatchSize = 2;
  const remainingPages = Array.from({ length: totalPages - 1 }, (_, idx) => idx + 2);
  let hadPartialPageFailures = false;

  for (let i = 0; i < remainingPages.length; i += pageBatchSize) {
    const batch = remainingPages.slice(i, i + pageBatchSize);
    const batchResults = await Promise.allSettled(
      batch.map(async (page) => {
        const params = buildParams({
          ...filters,
          page,
          page_size: pageSize,
        });
        const data = await apiFetch<{ demand: NetworkDemandRow[] }>(
          `/network/demand?${params.toString()}`
        );
        return data.demand ?? [];
      })
    );

    for (const result of batchResults) {
      if (result.status === 'fulfilled') {
        allDemand.push(...result.value);
      } else {
        hadPartialPageFailures = true;
        console.warn('[leaderboard] Network demand page fetch failed; continuing with partial data:', result.reason);
      }
    }
  }

  if (hadPartialPageFailures) {
    console.warn('[leaderboard] Returning partial network demand dataset due to page-level failures.');
  }

  return allDemand;
}

/**
 * Fetch GPU metrics data with API-native filters.
 * For backward compatibility, also accepts window string as first arg (e.g. "24h").
 */
export async function fetchGPUMetrics(filtersOrWindow: GPUMetricsFilters | string): Promise<GPUMetricRow[]> {
  const filters: GPUMetricsFilters = typeof filtersOrWindow === 'string'
    ? { window: filtersOrWindow }
    : filtersOrWindow;

  const pageSize = 500;
  let page = 1;
  let totalPages = 1;
  const allMetrics: GPUMetricRow[] = [];

  // Fetch all result pages so overview/aggregates are based on the full dataset.
  do {
    const params = buildParams({
      ...filters,
      page,
      page_size: pageSize,
    });
    const data = await apiFetch<{ metrics: GPUMetricRow[]; pagination?: PaginationInfo }>(
      `/gpu/metrics?${params.toString()}`
    );

    allMetrics.push(...(data.metrics ?? []));

    const reportedTotalPages = data.pagination?.total_pages;
    totalPages = Number.isFinite(reportedTotalPages) && (reportedTotalPages ?? 0) > 0
      ? Number(reportedTotalPages)
      : 1;
    page += 1;
  } while (page <= totalPages);

  return allMetrics;
}

/**
 * Fetch SLA compliance data with API-native filters.
 * For backward compatibility, also accepts window string as first arg (e.g. "168h").
 */
export async function fetchSLACompliance(filtersOrWindow: SLAComplianceFilters | string): Promise<SLAComplianceRow[]> {
  const filters: SLAComplianceFilters = typeof filtersOrWindow === 'string'
    ? { window: filtersOrWindow }
    : filtersOrWindow;

  const pageSize = 500;
  const firstPageParams = buildParams({
    ...filters,
    page: 1,
    page_size: pageSize,
  });
  const firstPage = await apiFetch<{ compliance: SLAComplianceRow[]; pagination?: PaginationInfo }>(
    `/sla/compliance?${firstPageParams.toString()}`
  );

  const allCompliance: SLAComplianceRow[] = [...(firstPage.compliance ?? [])];
  const reportedTotalPages = firstPage.pagination?.total_pages;
  const totalPages = Number.isFinite(reportedTotalPages) && (reportedTotalPages ?? 0) > 0
    ? Number(reportedTotalPages)
    : 1;

  if (totalPages <= 1) return allCompliance;

  // Fetch remaining pages in small batches. This keeps request latency down
  // while still allowing progressive accumulation if later pages fail.
  const pageBatchSize = 2;
  const remainingPages = Array.from({ length: totalPages - 1 }, (_, idx) => idx + 2);
  let hadPartialPageFailures = false;

  for (let i = 0; i < remainingPages.length; i += pageBatchSize) {
    const batch = remainingPages.slice(i, i + pageBatchSize);
    const batchResults = await Promise.allSettled(
      batch.map(async (page) => {
        const params = buildParams({
          ...filters,
          page,
          page_size: pageSize,
        });
        const data = await apiFetch<{ compliance: SLAComplianceRow[] }>(
          `/sla/compliance?${params.toString()}`
        );
        return data.compliance ?? [];
      })
    );

    for (const result of batchResults) {
      if (result.status === 'fulfilled') {
        allCompliance.push(...result.value);
      } else {
        hadPartialPageFailures = true;
        console.warn('[leaderboard] SLA compliance page fetch failed; continuing with partial data:', result.reason);
      }
    }
  }

  if (hadPartialPageFailures) {
    console.warn('[leaderboard] Returning partial SLA compliance dataset due to page-level failures.');
  }

  return allCompliance;
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
