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
 * TTLs align with the dashboard BFF / NAAP API proxy expectations.
 *
 * NAAP API query caps (keep in sync with /api/v1/naap-api/warm):
 *   pipelines catalog: no window
 *
 * In-process TTLs below align with {@link TTL} in facade/cache.ts (1h) for dashboard aggregation.
 */

import { naapApiUpstreamUrl } from '@/lib/dashboard/naap-api-upstream';

// ---------------------------------------------------------------------------
// Raw API response types (internal — not exported to clients)
// ---------------------------------------------------------------------------

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

const PIPELINES_TTL = 3600;

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

async function fetchNaapPage(path: string, searchParams: URLSearchParams, ttl = PIPELINES_TTL): Promise<Response> {
  const url = new URL(naapApiUpstreamUrl(path));
  for (const [k, v] of searchParams.entries()) {
    url.searchParams.set(k, v);
  }
  return fetch(url.toString(), {
    next: { revalidate: ttl },
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
  ttl = PIPELINES_TTL,
): Promise<{ rows: T[]; totalPages: number }> {
  const pageSize = 200;
  params.set('page', '1');
  params.set('page_size', String(pageSize));

  const t0 = Date.now();

  let firstRes: Response;
  try {
    firstRes = await fetchNaapPage(path, new URLSearchParams(params), ttl);
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
        const res = await fetchNaapPage(path, pageParams, ttl);
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

/** Fetch the pipeline catalog (no pagination). */
export function getRawPipelineCatalog(): Promise<PipelineCatalogEntry[]> {
  return cachedFetch('pipelines', PIPELINES_TTL * 1000, async () => {
    const t0 = Date.now();
    const res = await fetch(naapApiUpstreamUrl('pipelines'), {
      next: { revalidate: PIPELINES_TTL },
      signal: AbortSignal.timeout(120_000),
    });
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
    if (pipelines.length === 0) {
      throw new Error('[dashboard/raw-data] /pipelines returned no recognizable pipeline entries');
    }
    console.log(`[dashboard/raw-data] pipelines fetched (${pipelines.length} entries) in ${Date.now() - t0}ms`);
    return pipelines;
  });
}

/** TTL seconds per NAAP API endpoint — used by instrumentation re-warm interval. */
export const NAAP_API_CACHE_TTLS = {
  pipelines: PIPELINES_TTL,
  network: 3600,
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
  pipelines: { count: number };
}> {
  let pipelinesCount = 0;
  try {
    const pipelines = await getRawPipelineCatalog();
    pipelinesCount = pipelines.length;
  } catch (err) {
    console.warn('[dashboard/raw-data] warm: pipelines fetch skipped:', err);
  }
  return {
    pipelines: { count: pipelinesCount },
  };
}
