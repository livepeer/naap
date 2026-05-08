/**
 * Per-pipeline model FPS map — from GET /v1/streaming/models (`avg_fps`) per OpenAPI.
 *
 * OpenAPI: that endpoint is a fixed **24-hour** weighted average output FPS and only
 * includes `live-video-to-video` rows. It does not accept `start`/`end` query params;
 * callers may still pass a window for API compatibility, but we cache a single merged map.
 *
 * Legacy GET /v1/perf/by-model is not in API v1; this preserves the facade shape
 * `${pipeline}:${model}` → avg FPS for the overview and pipeline catalog augment.
 */

import { cachedFetch, TTL } from '../cache.js';
import { naapGet } from '../naap-get.js';

interface StreamingModelRow {
  Pipeline?: string;
  Model?: string;
  pipeline?: string;
  model?: string;
  avg_fps?: number;
  AvgFPS?: number;
}

/** One in-process cache entry per process — upstream window is always last 24h per OpenAPI. */
const STREAMING_MODELS_FPS_CACHE_KEY = 'facade:streaming-models:fps-by-pipeline-model';

export async function resolvePerfByModel(_opts: {
  start: string;
  end: string;
}): Promise<Record<string, number>> {
  return cachedFetch(STREAMING_MODELS_FPS_CACHE_KEY, TTL.PIPELINES, async () => {
    const result = await naapGet<StreamingModelRow[] | null | undefined>(
      'streaming/models',
      undefined,
      {
        cache: 'no-store',
        errorLabel: 'perf-by-model',
      },
    );
    const rawRows = result ?? [];

    const rows = Array.isArray(rawRows) ? rawRows : [];
    const out = new Map<string, number>();

    for (const row of rows) {
      const pipeline = (row.Pipeline ?? row.pipeline)?.trim();
      const model = (row.Model ?? row.model)?.trim();
      const fps = row.avg_fps ?? row.AvgFPS;
      if (!pipeline || !model || !Number.isFinite(fps)) continue;
      out.set(`${pipeline}:${model}`, fps as number);
    }

    return Object.fromEntries(out.entries());
  });
}
