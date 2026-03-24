/**
 * Server-side raw data fetchers for the dashboard BFF.
 *
 * Each function fetches the maximum available window from upstream and returns
 * the combined rows from all pages.
 *
 * Caching strategy (two layers):
 *   1. In-process TTL cache — guarantees at most ONE upstream fetch per
 *      endpoint per TTL window, even in `next dev` where the Next.js Data
 *      Cache is disabled. Multiple resolvers calling the same getter within
 *      a TTL window share the cached Promise (coalescing concurrent calls).
 *   2. Next.js `next: { revalidate }` on each fetch — provides persistent
 *      cross-request caching in production builds.
 *
 * TTLs match ENDPOINT_TTL_SECONDS in the leaderboard proxy route:
 *   demand=180s, sla=300s, gpu=300s, pipelines=900s
 *
 * Leaderboard `window=` query caps (keep in sync with /api/v1/leaderboard/warm):
 *   network/demand + sla/compliance + gpu/metrics: 24h max — pipelines: no window
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
// In-process TTL cache
//
// Guarantees at most one upstream fetch per endpoint per TTL window.
// Stores the *Promise* so concurrent callers coalesce onto the same flight.
// ---------------------------------------------------------------------------

interface CacheEntry<T> {
  expiresAt: number;
  promise: Promise<T>;
}

const memCache = new Map<string, CacheEntry<unknown>>();

function cachedFetch<T>(key: string, ttlMs: number, fetcher: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const existing = memCache.get(key) as CacheEntry<T> | undefined;
  if (existing && existing.expiresAt > now) {
    console.log(`[dashboard/raw-data] CACHE HIT  ${key} (expires in ${Math.round((existing.expiresAt - now) / 1000)}s)`);
    return existing.promise;
  }

  console.log(`[dashboard/raw-data] CACHE MISS ${key} — fetching upstream`);
  const promise = fetcher().catch((err) => {
    memCache.delete(key);
    throw err;
  });

  memCache.set(key, { expiresAt: now + ttlMs, promise: promise as Promise<unknown> });
  return promise;
}

// ---------------------------------------------------------------------------
// Internal pagination helper
// ---------------------------------------------------------------------------

/** Mirrors naap/script.sh: page_size=200, page=1..pagination.total_pages, same ?query shape as curl. */
function parseTotalPages(pagination: { total_pages?: unknown } | undefined): number {
  const raw = pagination?.total_pages;
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.floor(n);
}

async function fetchAllPages<T>(
  path: string,
  dataKey: string,
  params: URLSearchParams,
  ttlSeconds: number
): Promise<{ rows: T[]; totalPages: number }> {
  const pageSize = 200;
  params.set('page', '1');
  params.set('page_size', String(pageSize));

  const firstUrl = `${LEADERBOARD_API_URL}/api/${path}?${params.toString()}`;
  const t0 = Date.now();

  let firstRes: Response;
  try {
    firstRes = await fetch(firstUrl, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(60_000),
      next: { revalidate: ttlSeconds },
    });
  } catch (err) {
    throw new Error(
      `[dashboard/raw-data] ${path} page 1 request failed against ${LEADERBOARD_API_URL}: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  }

  if (!firstRes.ok) {
    throw new Error(
      `[dashboard/raw-data] ${path} page 1 returned HTTP ${firstRes.status} from ${LEADERBOARD_API_URL}`
    );
  }

  const firstBody = (await firstRes.json()) as Record<string, unknown>;
  const firstRows = firstBody[dataKey] as T[] | undefined;
  if (!Array.isArray(firstRows)) {
    throw new Error(
      `[dashboard/raw-data] ${path} page 1 missing expected "${dataKey}" array from ${LEADERBOARD_API_URL}`
    );
  }
  const totalPages = parseTotalPages(firstBody.pagination as { total_pages?: unknown } | undefined);

  if (totalPages <= 1) {
    console.log(`[dashboard/raw-data] ${path} fetched 1 page (${firstRows.length} rows) in ${Date.now() - t0}ms`);
    return { rows: firstRows, totalPages };
  }

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
          next: { revalidate: ttlSeconds },
        });
        if (!res.ok) {
          throw new Error(
            `[dashboard/raw-data] ${path} page ${page} returned HTTP ${res.status} from ${LEADERBOARD_API_URL}`
          );
        }
        const body = (await res.json()) as Record<string, unknown>;
        const rows = body[dataKey] as T[] | undefined;
        if (!Array.isArray(rows)) {
          throw new Error(
            `[dashboard/raw-data] ${path} page ${page} missing expected "${dataKey}" array from ${LEADERBOARD_API_URL}`
          );
        }
        return rows;
      } catch (err) {
        throw new Error(
          `[dashboard/raw-data] ${path} page ${page} request failed against ${LEADERBOARD_API_URL}: ${
            err instanceof Error ? err.message : String(err)
          }`
        );
      }
    })
  );

  const allRows = [...firstRows, ...pageResults.flat()];
  console.log(`[dashboard/raw-data] ${path} fetched ${totalPages} pages (${allRows.length} rows) in ${Date.now() - t0}ms`);
  return { rows: allRows, totalPages };
}

// ---------------------------------------------------------------------------
// Public fetchers
// ---------------------------------------------------------------------------

/** Max lookback hours for all leaderboard time-series (demand, SLA, GPU). */
export const DASHBOARD_LEADERBOARD_MAX_HOURS = 24;

/** Upstream `window=` string for paginated leaderboard series (must match {@link DASHBOARD_LEADERBOARD_MAX_HOURS}). */
export const DASHBOARD_LEADERBOARD_WINDOW = `${DASHBOARD_LEADERBOARD_MAX_HOURS}h`;

/**
 * Clamp lookback hours to [1, {@link DASHBOARD_LEADERBOARD_MAX_HOURS}].
 * `undefined` → max hours (dashboard default fetch).
 */
export function clampLeaderboardLookbackHours(hours?: number): number {
  if (!Number.isFinite(hours) || hours == null || hours <= 0) {
    return DASHBOARD_LEADERBOARD_MAX_HOURS;
  }
  return Math.min(Math.max(Math.floor(hours), 1), DASHBOARD_LEADERBOARD_MAX_HOURS);
}

/**
 * Returns true when dashboard GPU capacity + pipeline panels should pull from
 * ClickHouse instead of the leaderboard API.
 *
 * Set `NETWORK_DATA_SOURCE=clickhouse` in env to enable.
 * Any other value (or unset) → leaderboard API (default).
 */
export function isNetworkDataSourceClickHouse(): boolean {
  return process.env.NETWORK_DATA_SOURCE?.trim().toLowerCase() === 'clickhouse';
}

/**
 * Fetch demand rows for a leaderboard lookback window.
 * Omit `lookbackHours` (or pass non-finite) to use {@link DASHBOARD_LEADERBOARD_MAX_HOURS}.
 */
export function getRawDemandRows(lookbackHours?: number): Promise<NetworkDemandRow[]> {
  const h = clampLeaderboardLookbackHours(lookbackHours);
  const windowStr = `${h}h`;
  return cachedFetch(`demand:${windowStr}`, DEMAND_TTL * 1000, () =>
    fetchAllPages<NetworkDemandRow>(
      'network/demand',
      'demand',
      new URLSearchParams({ window: windowStr }),
      DEMAND_TTL
    ).then((r) => r.rows)
  );
}

/**
 * Fetch SLA rows for a leaderboard lookback window.
 * Omit `lookbackHours` to use {@link DASHBOARD_LEADERBOARD_MAX_HOURS}.
 */
export function getRawSLARows(lookbackHours?: number): Promise<SLAComplianceRow[]> {
  const h = clampLeaderboardLookbackHours(lookbackHours);
  const windowStr = `${h}h`;
  return cachedFetch(`sla:${windowStr}`, SLA_TTL * 1000, () =>
    fetchAllPages<SLAComplianceRow>(
      'sla/compliance',
      'compliance',
      new URLSearchParams({ window: windowStr }),
      SLA_TTL
    ).then((r) => r.rows)
  );
}

/**
 * Fetch GPU metric rows for a leaderboard lookback window.
 * Omit `lookbackHours` to use {@link DASHBOARD_LEADERBOARD_MAX_HOURS}.
 */
export function getRawGPUMetricsRows(lookbackHours?: number): Promise<GPUMetricRow[]> {
  if (isNetworkDataSourceClickHouse()) {
    console.warn('[dashboard/raw-data] NETWORK_DATA_SOURCE=clickhouse — skipping gpu/metrics');
    return Promise.resolve([]);
  }
  const h = clampLeaderboardLookbackHours(lookbackHours);
  const windowStr = `${h}h`;
  return cachedFetch(`gpu:${windowStr}`, GPU_TTL * 1000, () =>
    fetchAllPages<GPUMetricRow>(
      'gpu/metrics',
      'metrics',
      new URLSearchParams({ window: windowStr }),
      GPU_TTL
    ).then((r) => r.rows)
  );
}

/** Fetch the pipeline catalog (no pagination). */
export function getRawPipelineCatalog(): Promise<PipelineCatalogEntry[]> {
  return cachedFetch('pipelines', PIPELINES_TTL * 1000, async () => {
    const url = `${LEADERBOARD_API_URL}/api/pipelines`;
    const t0 = Date.now();
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(60_000),
      next: { revalidate: PIPELINES_TTL },
    });
    if (!res.ok) {
      throw new Error(
        `[dashboard/raw-data] /api/pipelines returned HTTP ${res.status} from ${LEADERBOARD_API_URL}`
      );
    }
    const body = (await res.json()) as { pipelines?: PipelineCatalogEntry[] };
    if (!Array.isArray(body.pipelines)) {
      throw new Error(
        `[dashboard/raw-data] /api/pipelines missing expected "pipelines" array from ${LEADERBOARD_API_URL}`
      );
    }
    console.log(`[dashboard/raw-data] pipelines fetched (${body.pipelines.length} entries) in ${Date.now() - t0}ms`);
    return body.pipelines;
  });
}

/** TTL seconds per leaderboard endpoint — keep in sync with leaderboard proxy + warm route. */
export const LEADERBOARD_CACHE_TTLS = {
  demand: DEMAND_TTL,
  sla: SLA_TTL,
  gpu: GPU_TTL,
  pipelines: PIPELINES_TTL,
} as const;

/**
 * Fetches every page for one paginated leaderboard endpoint + window.
 * Populates Next.js fetch cache per URL; does not use the in-process mem cache.
 * Used by GET /api/v1/leaderboard/warm.
 */
export async function warmLeaderboardPaginated(
  path: string,
  dataKey: string,
  window: string,
  ttlSeconds: number
): Promise<{ pages: number; rows: number }> {
  const { rows, totalPages } = await fetchAllPages<unknown>(
    path,
    dataKey,
    new URLSearchParams({ window }),
    ttlSeconds
  );
  return { pages: totalPages, rows: rows.length };
}

/**
 * Single fetch for /api/pipelines (no pagination). Warms Next.js fetch cache only.
 */
export async function warmLeaderboardPipelines(ttlSeconds: number): Promise<{
  ok: boolean;
  status: number;
  count: number;
}> {
  const url = `${LEADERBOARD_API_URL}/api/pipelines`;
  const res = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(60_000),
    next: { revalidate: ttlSeconds },
  });
  if (!res.ok) {
    return { ok: false, status: res.status, count: 0 };
  }
  const body = (await res.json()) as { pipelines?: unknown[] };
  const count = Array.isArray(body.pipelines) ? body.pipelines.length : 0;
  return { ok: true, status: res.status, count };
}
