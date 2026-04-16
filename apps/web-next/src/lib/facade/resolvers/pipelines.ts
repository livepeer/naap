/**
 * Pipelines resolver — NAAP Dashboard API backed.
 *
 * The endpoint returns a combined response:
 *   { streaming: DashboardPipelineUsage[], requests: { by_pipeline, by_capability } }
 *
 * We extract `.streaming` which already includes per-model `modelMins` with
 * `avgFps` — no need for the previous fan-out to perf/by-model or pipeline-catalog.
 *
 * Source:
 *   GET /v1/dashboard/pipelines?limit=N&window=Nh
 */

import type {
  DashboardPipelineUsage,
} from '@naap/plugin-sdk';
import {
  PIPELINE_COLOR,
  DEFAULT_PIPELINE_COLOR,
} from '@/lib/dashboard/pipeline-config';
import type { DashboardPipelineModelMins } from '@naap/plugin-sdk';
import { cachedFetch, TTL } from '../cache.js';
import { naapGet } from '../naap-get.js';

/** Round to 2 decimal places. */
function r2(v: number): number {
  return Math.round(v * 100) / 100;
}

/** combined response shape from /v1/dashboard/pipelines */
interface DashboardPipelinesCombined {
  streaming: DashboardPipelineUsage[];
  requests?: unknown;
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

  return cachedFetch(`facade:pipelines:${safeLimit}:${hours}`, TTL.PIPELINES, async () => {
    const combined = await naapGet<DashboardPipelinesCombined>('dashboard/pipelines', {
      limit: String(safeLimit),
      window,
    }, {
      cache: 'no-store',
      errorLabel: 'pipelines',
    });

    const rows = combined.streaming;

    return rows.map((r): DashboardPipelineUsage => {
      const colorKey = r.name.trim().toLowerCase().replace(/\s+/g, '-');
      const modelMins: DashboardPipelineModelMins[] | undefined =
        r.modelMins && r.modelMins.length > 0
          ? r.modelMins.map((m) => ({ ...m, mins: r2(m.mins), avgFps: r2(m.avgFps) }))
          : undefined;
      return {
        name: r.name,
        sessions: r.sessions,
        mins: r2(r.mins),
        avgFps: r2(r.avgFps),
        color: PIPELINE_COLOR[colorKey] ?? DEFAULT_PIPELINE_COLOR,
        ...(modelMins ? { modelMins } : {}),
      };
    });
  });
}
