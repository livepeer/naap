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
  const start = opts.start.trim();
  const end = opts.end.trim();
  // Round to minute precision so nearby requests share the same cache entry.
  const cacheKey = `facade:perf-by-model:${start.slice(0, 16)}:${end.slice(0, 16)}`;

  const revalidateSec = Math.floor(TTL.PIPELINES / 1000);
  return cachedFetch(cacheKey, TTL.PIPELINES, async () => {
    const rawRows = await naapGet<PerfByModelRow[] | null | undefined>('perf/by-model', { start, end }, {
      next: { revalidate: revalidateSec },
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

