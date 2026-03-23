/**
 * Server-side raw data fetchers for the dashboard BFF.
 *
 * Each function fetches the maximum available window from upstream and returns
 * the combined rows from all pages. Next.js `next: { revalidate }` on each
 * page fetch provides caching — one upstream fetch per endpoint (4 total).
 *
 * TTLs match ENDPOINT_TTL_SECONDS in the leaderboard proxy route:
 *   demand=180s, sla=300s, gpu=300s, pipelines=900s
 */

// ---------------------------------------------------------------------------
// Raw API response types (internal — not exported to clients)
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
// Constants
// ---------------------------------------------------------------------------

const LEADERBOARD_API_URL = process.env.LEADERBOARD_API_URL || 'https://leaderboard-api.livepeer.cloud';

const DEMAND_TTL = 3 * 60;      // 180 seconds
const SLA_TTL = 5 * 60;         // 300 seconds
const GPU_TTL = 5 * 60;         // 300 seconds
const PIPELINES_TTL = 15 * 60;  // 900 seconds

// ---------------------------------------------------------------------------
// Internal pagination helper
// ---------------------------------------------------------------------------

/**
 * Fetch all pages of a paginated leaderboard endpoint.
 * Uses next: { revalidate: ttlSeconds } so Next.js caches each page.
 */
async function fetchAllPages<T>(
  path: string,
  dataKey: string,
  params: URLSearchParams,
  ttlSeconds: number
): Promise<T[]> {
  const pageSize = 500;
  params.set('page', '1');
  params.set('page_size', String(pageSize));

  const firstUrl = `${LEADERBOARD_API_URL}/api/${path}?${params.toString()}`;

  let firstRes: Response;
  try {
    firstRes = await fetch(firstUrl, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(60_000),
      // @ts-expect-error — Next.js extended fetch options
      next: { revalidate: ttlSeconds },
    });
  } catch (err) {
    console.warn(`[dashboard/raw-data] fetch error for ${path} page 1:`, err);
    return [];
  }

  if (!firstRes.ok) {
    console.warn(`[dashboard/raw-data] ${path} page 1 returned ${firstRes.status}`);
    return [];
  }

  const firstBody = (await firstRes.json()) as Record<string, unknown>;
  const firstRows = (firstBody[dataKey] as T[] | undefined) ?? [];
  const pagination = firstBody.pagination as { total_pages?: number } | undefined;
  const totalPages = pagination?.total_pages ?? 1;

  if (totalPages <= 1) return firstRows;

  // Fetch remaining pages in parallel
  const pageNums = Array.from({ length: totalPages - 1 }, (_, i) => i + 2);
  const pageResults = await Promise.all(
    pageNums.map(async (page) => {
      const pageParams = new URLSearchParams(params);
      pageParams.set('page', String(page));
      const url = `${LEADERBOARD_API_URL}/api/${path}?${pageParams.toString()}`;
      try {
        const res = await fetch(url, {
          headers: { Accept: 'application/json' },
          signal: AbortSignal.timeout(60_000),
          // @ts-expect-error — Next.js extended fetch options
          next: { revalidate: ttlSeconds },
        });
        if (!res.ok) {
          console.warn(`[dashboard/raw-data] ${path} page ${page} returned ${res.status}`);
          return [] as T[];
        }
        const body = (await res.json()) as Record<string, unknown>;
        return (body[dataKey] as T[] | undefined) ?? ([] as T[]);
      } catch (err) {
        console.warn(`[dashboard/raw-data] fetch error for ${path} page ${page}:`, err);
        return [] as T[];
      }
    })
  );

  return [...firstRows, ...pageResults.flat()];
}

// ---------------------------------------------------------------------------
// Public fetchers
// ---------------------------------------------------------------------------

/** Fetch all demand rows for the maximum 720h window. */
export async function getRawDemandRows(): Promise<NetworkDemandRow[]> {
  return fetchAllPages<NetworkDemandRow>(
    'network/demand',
    'demand',
    new URLSearchParams({ window: '720h' }),
    DEMAND_TTL
  );
}

/** Fetch all SLA compliance rows for the maximum 720h window. */
export async function getRawSLARows(): Promise<SLAComplianceRow[]> {
  return fetchAllPages<SLAComplianceRow>(
    'sla/compliance',
    'compliance',
    new URLSearchParams({ window: '720h' }),
    SLA_TTL
  );
}

/** Fetch all GPU metric rows for the maximum 72h window. */
export async function getRawGPUMetricsRows(): Promise<GPUMetricRow[]> {
  return fetchAllPages<GPUMetricRow>(
    'gpu/metrics',
    'metrics',
    new URLSearchParams({ window: '72h' }),
    GPU_TTL
  );
}

/** Fetch the pipeline catalog (no pagination). */
export async function getRawPipelineCatalog(): Promise<PipelineCatalogEntry[]> {
  const url = `${LEADERBOARD_API_URL}/api/pipelines`;
  try {
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(60_000),
      // @ts-expect-error — Next.js extended fetch options
      next: { revalidate: PIPELINES_TTL },
    });
    if (!res.ok) {
      console.warn(`[dashboard/raw-data] /api/pipelines returned ${res.status}`);
      return [];
    }
    const body = (await res.json()) as { pipelines?: PipelineCatalogEntry[] };
    return body.pipelines ?? [];
  } catch (err) {
    console.warn('[dashboard/raw-data] fetch error for /api/pipelines:', err);
    return [];
  }
}
