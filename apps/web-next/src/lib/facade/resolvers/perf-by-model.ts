/**
 * Perf-by-model resolver — NAAP API backed.
 *
 * Fetches GET /v1/perf/by-model?start=...&end=... and returns
 * `${pipeline}:${model}` -> AvgFPS.
 */

import { naapApiUpstreamUrl } from '@/lib/dashboard/naap-api-upstream';
import { cachedFetch, TTL } from '../cache.js';

interface PerfByModelRow {
  ModelID?: string;
  Pipeline?: string;
  AvgFPS?: number;
}

async function naapGet<T>(path: string, params: Record<string, string>): Promise<T> {
  const url = new URL(naapApiUpstreamUrl(path));
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
  const res = await fetch(url.toString(), { next: { revalidate: 60 } });
  if (!res.ok) throw new Error(`[facade/perf-by-model] ${path} returned HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

export async function resolvePerfByModel(opts: {
  start: string;
  end: string;
}): Promise<Record<string, number>> {
  const start = opts.start.trim();
  const end = opts.end.trim();
  const cacheKey = `facade:perf-by-model:${start}:${end}`;

  return cachedFetch(cacheKey, TTL.PIPELINES * 1000, async () => {
    const rows = await naapGet<PerfByModelRow[]>('perf/by-model', { start, end });
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

