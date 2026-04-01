/**
 * Pipelines resolver — NAAP Dashboard API backed.
 *
 * Single call to GET /v1/dashboard/pipelines which returns top N pipelines
 * pre-aggregated by session count over the last 24 hours, including mins.
 *
 * Source:
 *   GET /v1/dashboard/pipelines?limit=N
 */

import type { DashboardPipelineUsage } from '@naap/plugin-sdk';
import { naapApiUpstreamUrl } from '@/lib/dashboard/naap-api-upstream';
import { PIPELINE_COLOR, DEFAULT_PIPELINE_COLOR } from '@/lib/dashboard/pipeline-config';
import { cachedFetch, TTL } from '../cache.js';

interface DashboardPipelineRow {
  name: string;
  sessions: number;
  mins: number;
  avgFps: number;
}

async function naapGet<T>(path: string, params: Record<string, string>): Promise<T> {
  const url = new URL(naapApiUpstreamUrl(path));
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url.toString(), { next: { revalidate: 60 } });
  if (!res.ok) throw new Error(`[facade/pipelines] ${path} returned HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

export async function resolvePipelines(opts: { limit?: number }): Promise<DashboardPipelineUsage[]> {
  const limit = opts.limit ?? 5;
  return cachedFetch(`facade:pipelines:${limit}`, TTL.PIPELINES * 1000, async () => {
    const rows = await naapGet<DashboardPipelineRow[]>('dashboard/pipelines', { limit: String(limit) });
    return rows.map((r): DashboardPipelineUsage => ({
      name: r.name,
      sessions: r.sessions,
      mins: r.mins,
      avgFps: r.avgFps,
      color: PIPELINE_COLOR[r.name] ?? DEFAULT_PIPELINE_COLOR,
    }));
  });
}
