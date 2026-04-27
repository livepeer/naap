/**
 * Pipelines resolver — NAAP Dashboard API backed.
 *
 * Uses the dashboard pipelines endpoint and maps the response into
 * DashboardPipelineUsage rows for the facade.
 *
 * Source:
 *   GET /v1/dashboard/pipelines?limit=N&window=Nh
 */

import type {
  DashboardPipelineModelMins,
  DashboardPipelineUsage,
} from '@naap/plugin-sdk';
import {
  PIPELINE_COLOR,
  DEFAULT_PIPELINE_COLOR,
  LIVE_VIDEO_PIPELINE_ID,
} from '@/lib/dashboard/pipeline-config';
import { cachedFetch, TTL } from '../cache.js';
import { naapGet } from '../naap-get.js';
import { resolveKPI } from './kpi.js';
import { resolvePipelineCatalog } from './pipeline-catalog.js';
import { resolvePerfByModel } from './perf-by-model.js';

interface DashboardPipelineRow {
  name: string;
  sessions: number;
  mins: number;
  avgFps: number;
}

function timeframeRangeIso(hours: number): { start: string; end: string } {
  const end = new Date();
  const start = new Date(end.getTime() - hours * 60 * 60 * 1000);
  return { start: start.toISOString(), end: end.toISOString() };
}

async function fetchModelMinsForPipeline(opts: {
  pipeline: string;
  models: string[];
  timeframe: string;
  fpsByPipelineModel: Record<string, number>;
}): Promise<DashboardPipelineModelMins[]> {
  const { pipeline, models, timeframe, fpsByPipelineModel } = opts;
  if (models.length === 0) return [];

  const settled = await Promise.allSettled(
    models.map(async (model): Promise<DashboardPipelineModelMins> => {
      const kpi = await resolveKPI({ timeframe, pipeline, model_id: model });
      const fps = fpsByPipelineModel[`${pipeline}:${model}`];
      return {
        model,
        mins: Number(kpi.dailyUsageMins?.value ?? 0),
        sessions: Math.max(0, Math.round(Number(kpi.dailySessionCount?.value ?? 0))),
        avgFps: Number.isFinite(fps) ? fps : 0,
      };
    }),
  );

  return settled
    .filter((r): r is PromiseFulfilledResult<DashboardPipelineModelMins> => r.status === 'fulfilled')
    .map((r) => r.value)
    .sort((a, b) => b.mins - a.mins);
}

/** Maximum live-video models to fan out KPI calls for. Limits server-side parallelism. */
const MAX_LIVE_VIDEO_KPI_MODELS = 30;

async function resolveLiveVideoModelMins(opts: {
  hours: number;
  timeframe: string;
}): Promise<DashboardPipelineModelMins[]> {
  const { hours, timeframe } = opts;
  return cachedFetch(`facade:pipelines:live-video-model-mins:${hours}`, TTL.PIPELINES, async () => {
    const [catalog, fpsByPipelineModel] = await Promise.all([
      resolvePipelineCatalog().catch(() => []),
      resolvePerfByModel(timeframeRangeIso(hours)).catch(() => ({} as Record<string, number>)),
    ]);
    const allModels = catalog.find((entry) => entry.id === LIVE_VIDEO_PIPELINE_ID)?.models ?? [];

    // Prioritise models with recent FPS activity; cap at MAX_LIVE_VIDEO_KPI_MODELS
    // to keep the fan-out bounded regardless of how many models the catalog contains.
    const ranked = allModels
      .map((m) => ({ model: m, fps: fpsByPipelineModel[`${LIVE_VIDEO_PIPELINE_ID}:${m}`] ?? 0 }))
      .sort((a, b) => b.fps - a.fps)
      .slice(0, MAX_LIVE_VIDEO_KPI_MODELS)
      .map((x) => x.model);

    return fetchModelMinsForPipeline({
      pipeline: LIVE_VIDEO_PIPELINE_ID,
      models: ranked,
      timeframe,
      fpsByPipelineModel,
    });
  });
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
  const timeframe = String(hours);

  return cachedFetch(`facade:pipelines:${safeLimit}:${hours}`, TTL.PIPELINES, async () => {
    const rows = await naapGet<DashboardPipelineRow[]>('dashboard/pipelines', {
      limit: String(safeLimit),
      window,
    }, {
      cache: 'no-store',
      errorLabel: 'pipelines',
    });
    const includesLiveVideoPipeline = rows.some((row) => row.name === LIVE_VIDEO_PIPELINE_ID);
    const liveVideoModelMins = includesLiveVideoPipeline
      ? await resolveLiveVideoModelMins({ hours, timeframe })
      : [];

    const enriched = rows.map((r): DashboardPipelineUsage => {
      const modelMins = r.name === LIVE_VIDEO_PIPELINE_ID ? liveVideoModelMins : [];
      const colorKey = r.name.trim().toLowerCase().replace(/\s+/g, '-');
      return {
        name: r.name,
        sessions: r.sessions,
        mins: r.mins,
        avgFps: r.avgFps,
        color: PIPELINE_COLOR[colorKey] ?? DEFAULT_PIPELINE_COLOR,
        ...(modelMins.length > 0 ? { modelMins } : {}),
      };
    });

    return enriched;
  });
}
