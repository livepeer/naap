/**
 * Pipelines resolver — NAAP API backed.
 *
 * Fetches GET /v1/pipelines and maps rows to DashboardPipelineUsage[].
 *
 * Known limitations (Phase 1):
 *   - mins: 0 — no minutes metric in NAAP API
 *   - modelMins: [] — needs per-pipeline call to /v1/pipelines/{pipeline}
 *
 * Source:
 *   GET /v1/pipelines → pipeline usage rows
 */

import type { DashboardPipelineUsage } from '@naap/plugin-sdk';
import { naapApiUpstreamUrl } from '@/lib/dashboard/naap-api-upstream';
import {
  PIPELINE_DISPLAY,
  PIPELINE_COLOR,
  DEFAULT_PIPELINE_COLOR,
} from '@/lib/dashboard/pipeline-config';
import { cachedFetch, TTL } from '../cache.js';

// ---------------------------------------------------------------------------
// Raw NAAP API types
// ---------------------------------------------------------------------------

interface NaapPipelineRow {
  Pipeline: string;
  ActiveStreams: number;
  RequestedCount: number;
  SuccessRate: number;
  AvgInferenceFPS: number;
  TotalPaymentsWEI: string;
  WarmOrchCount: number;
  TopOrchAddress: string;
}

// ---------------------------------------------------------------------------
// HTTP helper
// ---------------------------------------------------------------------------

async function naapGet<T>(path: string): Promise<T> {
  const url = naapApiUpstreamUrl(path);
  const res = await fetch(url, { next: { revalidate: 60 } });
  if (!res.ok) throw new Error(`[facade/pipelines] ${path} returned HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// Resolver
// ---------------------------------------------------------------------------

export async function resolvePipelines(opts: {
  limit?: number;
}): Promise<DashboardPipelineUsage[]> {
  return cachedFetch('facade:pipelines', TTL.PIPELINES * 1000, async () => {
    const rows = await naapGet<NaapPipelineRow[]>('pipelines');

    const filtered = rows
      .filter((r) => r.Pipeline !== '' && PIPELINE_DISPLAY[r.Pipeline] !== null)
      .sort((a, b) => b.RequestedCount - a.RequestedCount);

    const limit = opts.limit ?? 5;

    return filtered.slice(0, limit).map((r): DashboardPipelineUsage => ({
      name: PIPELINE_DISPLAY[r.Pipeline] ?? r.Pipeline,
      mins: 0, // not available in NAAP API
      sessions: r.RequestedCount,
      avgFps: r.AvgInferenceFPS,
      color: PIPELINE_COLOR[r.Pipeline] ?? DEFAULT_PIPELINE_COLOR,
      modelMins: [], // needs per-pipeline call — out of scope for Phase 1
    }));
  });
}
