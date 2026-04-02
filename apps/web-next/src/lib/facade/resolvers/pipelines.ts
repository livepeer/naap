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
import { PIPELINE_COLOR, DEFAULT_PIPELINE_COLOR } from '@/lib/dashboard/pipeline-config';
import { cachedFetch, TTL } from '../cache.js';
import { naapGet } from '../naap-get.js';

interface DashboardPipelineRow {
  name: string;
  sessions: number;
  mins: number;
  avgFps: number;
}

export async function resolvePipelines(opts: { limit?: number; timeframe?: string }): Promise<DashboardPipelineUsage[]> {
  const raw = Number(opts.limit ?? 5);
  const safeLimit = Math.max(
    1,
    Math.min(Math.floor(Number.isFinite(raw) ? raw : 5), 200),
  );
  const parsed = parseInt(opts.timeframe ?? '24', 10);
  const hours = Math.max(1, Math.min(Number.isFinite(parsed) ? parsed : 24, 168));
  const window = `${hours}h`;
  const revalidateSec = Math.floor(TTL.PIPELINES / 1000);
  return cachedFetch(`facade:pipelines:${safeLimit}:${hours}`, TTL.PIPELINES, async () => {
    const rows = await naapGet<DashboardPipelineRow[]>('dashboard/pipelines', {
      limit: String(safeLimit),
      window,
    }, {
      next: { revalidate: revalidateSec },
      errorLabel: 'pipelines',
    });
    return rows.map((r): DashboardPipelineUsage => {
      const colorKey = r.name.trim().toLowerCase().replace(/\s+/g, '-');
      return {
        name: r.name,
        sessions: r.sessions,
        mins: r.mins,
        avgFps: r.avgFps,
        color: PIPELINE_COLOR[colorKey] ?? DEFAULT_PIPELINE_COLOR,
      };
    });
  });
}
