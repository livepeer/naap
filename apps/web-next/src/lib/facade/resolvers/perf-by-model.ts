/**
 * Perf-by-model resolver — NAAP API backed.
 *
 * Fetches GET /v1/perf/by-model?start=...&end=... and returns
 * `${pipeline}:${model}` -> AvgFPS.
 */

import { cachedFetch, TTL } from '../cache.js';
import { naapGet } from '../naap-get.js';

interface PerfByModelRow {
  ModelID?: string;
  Pipeline?: string;
  AvgFPS?: number;
}

export async function resolvePerfByModel(opts: {
  start: string;
  end: string;
}): Promise<Record<string, number>> {
  // Round to hour precision so nearby requests within the same hour share the
  // same cache entry — and pass the rounded window to the upstream call so the
  // cached response exactly matches the queried range.
  const roundedStart = opts.start.trim().slice(0, 13);
  const roundedEnd = opts.end.trim().slice(0, 13);
  const cacheKey = `facade:perf-by-model:${roundedStart}:${roundedEnd}`;

  return cachedFetch(cacheKey, TTL.PIPELINES, async () => {
    const rawRows = await naapGet<PerfByModelRow[] | null | undefined>('perf/by-model', { start: roundedStart, end: roundedEnd }, {
      cache: 'no-store',
      errorLabel: 'perf-by-model',
    });
    const rows = Array.isArray(rawRows) ? rawRows : [];
    if (rawRows != null && !Array.isArray(rawRows)) {
      console.warn('[facade/perf-by-model] unexpected non-array response, treating as empty');
    }
    const out = new Map<string, number>();

    for (const row of rows) {
      const pipeline = row.Pipeline?.trim();
      const model = row.ModelID?.trim();
      const avgFps = row.AvgFPS;
      if (!pipeline || !model || !Number.isFinite(avgFps)) continue;
      out.set(`${pipeline}:${model}`, avgFps as number);
    }

    return Object.fromEntries(out.entries());
  });
}

