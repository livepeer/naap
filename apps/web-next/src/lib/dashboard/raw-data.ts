/**
 * Server-side raw data fetchers for the dashboard BFF.
 *
 * Each function fetches the maximum available window from upstream and returns
 * the combined rows from all pages.
 *
 * Caching: in-process TTL cache — guarantees at most ONE upstream fetch per
 * endpoint per TTL window (including `next dev`). Concurrent callers within a
 * TTL window share the same cached Promise.
 *
 * TTLs align with the dashboard BFF / NAAP API proxy expectations:
 *   demand=180s, sla=300s, pipelines=900s.
 *
 * NAAP API `window=` query caps (keep in sync with /api/v1/naap-api/warm):
 *   network/demand + sla/compliance: 24h max — pipelines catalog: no window
 */

import { naapApiUpstreamUrl } from '@/lib/dashboard/naap-api-upstream';

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

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((v): v is string => typeof v === 'string')
    .map((v) => v.trim())
    .filter(Boolean);
}

function firstNonEmptyString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed) return trimmed;
    }
  }
  return null;
}

function normalizePipelineCatalogEntry(raw: unknown): PipelineCatalogEntry | null {
  if (typeof raw === 'string') {
    const id = raw.trim();
    return id ? { id, models: [], regions: [] } : null;
  }

  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;

  const id = firstNonEmptyString(
    obj.id,
    obj.pipeline_id,
    obj.pipelineId,
    obj.Pipeline,
    obj.pipeline,
    obj.name,
  );
  if (!id) return null;

  return {
    id,
    models: toStringArray(obj.models ?? obj.Models ?? obj.model_ids ?? obj.modelIds),
    regions: toStringArray(obj.regions ?? obj.Regions),
  };
}

function normalizePipelineCatalog(rawRows: unknown[]): PipelineCatalogEntry[] {
  const merged = new Map<string, { models: Set<string>; regions: Set<string> }>();

  for (const raw of rawRows) {
    const entry = normalizePipelineCatalogEntry(raw);
    if (!entry) continue;

    const existing = merged.get(entry.id);
    if (existing) {
      entry.models.forEach((m) => existing.models.add(m));
      entry.regions.forEach((r) => existing.regions.add(r));
      continue;
    }

    merged.set(entry.id, {
      models: new Set(entry.models),
      regions: new Set(entry.regions),
    });
  }

  return [...merged.entries()].map(([id, acc]) => ({
    id,
    models: [...acc.models],
    regions: [...acc.regions],
  }));
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEMAND_TTL = 180;   // seconds — align with raw-data doc / BFF expectations
const SLA_TTL = 300;
const PIPELINES_TTL = 900;

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

/** `expiresAt === 0` means a fetch is in flight; TTL starts only after the promise resolves. */
function cachedFetch<T>(key: string, ttlMs: number, fetcher: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const existing = memCache.get(key) as CacheEntry<T> | undefined;
  if (existing) {
    if (existing.expiresAt > now) {
      console.log(`[dashboard/raw-data] CACHE HIT  ${key} (expires in ${Math.round((existing.expiresAt - now) / 1000)}s)`);
      return existing.promise;
    }
    if (existing.expiresAt === 0) {
      return existing.promise;
    }
    memCache.delete(key);
  }

  console.log(`[dashboard/raw-data] CACHE MISS ${key} — fetching upstream`);
  const promise = (async () => {
    try {
      const value = await fetcher();
      const entry = memCache.get(key) as CacheEntry<T> | undefined;
      if (entry) {
        entry.expiresAt = Date.now() + ttlMs;
      }
      return value;
    } catch (err) {
      memCache.delete(key);
      throw err;
    }
  })();

  memCache.set(key, { expiresAt: 0, promise: promise as Promise<unknown> });
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

/** Limit parallel page fetches so a cold cache does not open hundreds of sockets at once. */
const NAAP_PAGE_FETCH_CONCURRENCY = 8;

async function fetchNaapPage(path: string, searchParams: URLSearchParams): Promise<Response> {
  const url = new URL(naapApiUpstreamUrl(path));
  for (const [k, v] of searchParams.entries()) {
    url.searchParams.set(k, v);
  }
  return fetch(url.toString(), {
    next: { revalidate: 60 },
    signal: AbortSignal.timeout(120_000),
  });
}

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return [];
  const results: R[] = new Array(items.length);
  let nextIndex = 0;
  const workerCount = Math.max(1, Math.min(concurrency, items.length));
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (true) {
        const i = nextIndex++;
        if (i >= items.length) break;
        results[i] = await mapper(items[i], i);
      }
    }),
  );
  return results;
}

async function fetchAllPages<T>(
  path: string,
  dataKey: string,
  params: URLSearchParams,
): Promise<{ rows: T[]; totalPages: number }> {
  const pageSize = 200;
  params.set('page', '1');
  params.set('page_size', String(pageSize));

  const t0 = Date.now();

  let firstRes: Response;
  try {
    firstRes = await fetchNaapPage(path, new URLSearchParams(params));
  } catch (err) {
    throw new Error(
      `[dashboard/raw-data] ${path} page 1 fetch failed: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }

  if (!firstRes.ok) {
    throw new Error(
      `[dashboard/raw-data] ${path} page 1 returned HTTP ${firstRes.status}`,
    );
  }

  const firstBody = (await firstRes.json()) as Record<string, unknown>;
  const firstRows = firstBody[dataKey] as T[] | undefined;
  if (!Array.isArray(firstRows)) {
    throw new Error(
      `[dashboard/raw-data] ${path} page 1 missing expected "${dataKey}" array`,
    );
  }
  const totalPages = parseTotalPages(firstBody.pagination as { total_pages?: unknown } | undefined);

  if (totalPages <= 1) {
    console.log(`[dashboard/raw-data] ${path} fetched 1 page (${firstRows.length} rows) in ${Date.now() - t0}ms`);
    return { rows: firstRows, totalPages };
  }

  const pageNums = Array.from({ length: totalPages - 1 }, (_, i) => i + 2);
  const pageResults = await mapWithConcurrency(
    pageNums,
    NAAP_PAGE_FETCH_CONCURRENCY,
    async (page) => {
      const pageParams = new URLSearchParams(params);
      pageParams.set('page', String(page));
      try {
        const res = await fetchNaapPage(path, pageParams);
        if (!res.ok) {
          throw new Error(
            `[dashboard/raw-data] ${path} page ${page} returned HTTP ${res.status}`,
          );
        }
        const body = (await res.json()) as Record<string, unknown>;
        const rows = body[dataKey] as T[] | undefined;
        if (!Array.isArray(rows)) {
          throw new Error(
            `[dashboard/raw-data] ${path} page ${page} missing expected "${dataKey}" array`,
          );
        }
        return rows;
      } catch (err) {
        throw new Error(
          `[dashboard/raw-data] ${path} page ${page} fetch failed: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    },
  );

  const allRows = [...firstRows, ...pageResults.flat()];
  console.log(`[dashboard/raw-data] ${path} fetched ${totalPages} pages (${allRows.length} rows) in ${Date.now() - t0}ms`);
  return { rows: allRows, totalPages };
}

// ---------------------------------------------------------------------------
// Public fetchers
// ---------------------------------------------------------------------------

/** Max lookback hours for all NAAP API time-series (demand, SLA, GPU). */
export const DASHBOARD_MAX_HOURS = 24;

/** Upstream `window=` string for paginated NAAP API series (must match {@link DASHBOARD_MAX_HOURS}). */
export const DASHBOARD_WINDOW = `${DASHBOARD_MAX_HOURS}h`;

/**
 * Clamp lookback hours to [1, {@link DASHBOARD_MAX_HOURS}].
 * `undefined` → max hours (dashboard default fetch).
 */
export function clampLookbackHours(hours?: number): number {
  if (!Number.isFinite(hours) || hours == null || hours <= 0) {
    return DASHBOARD_MAX_HOURS;
  }
  return Math.min(Math.max(Math.floor(hours), 1), DASHBOARD_MAX_HOURS);
}

function filterRowsByWindowStart<T extends { window_start: string }>(
  rows: T[],
  lookbackHours: number
): T[] {
  if (rows.length === 0) return rows;

  let maxTs = 0;
  for (const r of rows) {
    const ts = Date.parse(r.window_start);
    if (!Number.isNaN(ts) && ts > maxTs) maxTs = ts;
  }
  if (maxTs === 0) return rows;

  const HOUR_MS = 60 * 60 * 1000;
  const cutoffMs = maxTs - (lookbackHours - 1) * HOUR_MS;
  return rows.filter(r => {
    const ts = Date.parse(r.window_start);
    return !Number.isNaN(ts) && ts >= cutoffMs;
  });
}

/**
 * Fetch demand rows for a NAAP API lookback window.
 *
 * Always fetches the max 24h window from upstream (single cache key) and
 * filters in memory for sub-windows. This means switching from 12h → 6h
 * is an instant cache hit rather than a separate upstream round-trip.
 */
export function getRawDemandRows(lookbackHours?: number): Promise<NetworkDemandRow[]> {
  const h = clampLookbackHours(lookbackHours);
  return cachedFetch(`demand:${DASHBOARD_MAX_HOURS}h`, DEMAND_TTL * 1000, () =>
    fetchAllPages<NetworkDemandRow>(
      'network/demand',
      'demand',
      new URLSearchParams({ window: DASHBOARD_WINDOW }),
    ).then((r) => r.rows)
  ).then(rows =>
    h >= DASHBOARD_MAX_HOURS ? rows : filterRowsByWindowStart(rows, h)
  );
}

/**
 * Fetch SLA rows for a NAAP API lookback window.
 *
 * Same max-window strategy as {@link getRawDemandRows}: always fetch 24h,
 * filter in memory for shorter timeframes.
 */
export function getRawSLARows(lookbackHours?: number): Promise<SLAComplianceRow[]> {
  const h = clampLookbackHours(lookbackHours);
  return cachedFetch(`sla:${DASHBOARD_MAX_HOURS}h`, SLA_TTL * 1000, () =>
    fetchAllPages<SLAComplianceRow>(
      'sla/compliance',
      'compliance',
      new URLSearchParams({ window: DASHBOARD_WINDOW }),
    ).then((r) => r.rows)
  ).then(rows =>
    h >= DASHBOARD_MAX_HOURS ? rows : filterRowsByWindowStart(rows, h)
  );
}

/** Fetch the pipeline catalog (no pagination). */
export function getRawPipelineCatalog(): Promise<PipelineCatalogEntry[]> {
  return cachedFetch('pipelines', PIPELINES_TTL * 1000, async () => {
    const t0 = Date.now();
    const res = await fetch(naapApiUpstreamUrl('pipelines'), { next: { revalidate: 60 }, signal: AbortSignal.timeout(120_000) });
    if (!res.ok) {
      throw new Error(
        `[dashboard/raw-data] /pipelines returned HTTP ${res.status}`,
      );
    }
    const body = (await res.json()) as { pipelines?: unknown[] } | unknown[];
    const rawRows = Array.isArray(body)
      ? body
      : Array.isArray((body as { pipelines?: unknown[] }).pipelines)
        ? (body as { pipelines: unknown[] }).pipelines
        : null;
    if (!rawRows) {
      throw new Error(
        '[dashboard/raw-data] /pipelines missing expected "pipelines" array',
      );
    }
    const pipelines = normalizePipelineCatalog(rawRows);
    console.log(`[dashboard/raw-data] pipelines fetched (${pipelines.length} entries) in ${Date.now() - t0}ms`);
    return pipelines;
  });
}

/** TTL seconds per NAAP API endpoint — used by instrumentation re-warm interval. */
export const NAAP_API_CACHE_TTLS = {
  demand: DEMAND_TTL,
  sla: SLA_TTL,
  pipelines: PIPELINES_TTL,
} as const;

// ---------------------------------------------------------------------------
// Unified cache warmer
// ---------------------------------------------------------------------------

/**
 * Pre-populate the in-process mem cache for all NAAP API-backed dashboard
 * inputs. Uses the same getters as the resolvers so cache keys match exactly.
 *
 * Called from:
 *   - `instrumentation.ts` at server startup (awaited — first user is guaranteed warm)
 *   - background `setInterval` to keep the cache fresh
 *   - `GET /api/v1/naap-api/warm` (Vercel cron)
 */
export async function warmDashboardCaches(): Promise<{
  demand: { rows: number };
  sla: { rows: number };
  pipelines: { count: number };
}> {
  const [demandRows, slaRows, pipelines] = await Promise.all([
    getRawDemandRows(),
    getRawSLARows(),
    getRawPipelineCatalog(),
  ]);
  return {
    demand: { rows: demandRows.length },
    sla: { rows: slaRows.length },
    pipelines: { count: pipelines.length },
  };
}
