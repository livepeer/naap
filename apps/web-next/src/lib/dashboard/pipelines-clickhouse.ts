/**
 * Pipeline usage data from ClickHouse `stream_trace` events.
 *
 * Derives hourly session counts per pipeline from the raw stream_trace
 * events in network_events. Labels use constraint IDs (e.g. streamdiffusion-sdxl)
 * to match the Network GPUs BY PIPELINE breakdown.
 *
 * Env (server-only): CLICKHOUSE_URL, CLICKHOUSE_USER, CLICKHOUSE_PASSWORD
 *
 * Caching: two-layer strategy matching raw-data.ts / gpu-capacity-clickhouse.ts.
 */

import type { DashboardPipelineUsage } from '@naap/plugin-sdk';
import {
  PIPELINE_DISPLAY,
  PIPELINE_COLOR,
  DEFAULT_PIPELINE_COLOR,
} from './pipeline-config.js';

export const PIPELINES_CH_TTL_SECONDS = 3 * 60;

// ---------------------------------------------------------------------------
// SQL — session counts per pipeline per hour from stream_trace events
// ---------------------------------------------------------------------------

function buildPipelineUsageSQL(lookbackMs: number): string {
  return `
WITH
session_pipeline AS (
    SELECT
        JSONExtractString(toString(data), 'stream_id') AS stream_id,
        argMax(JSONExtractString(toString(data), 'pipeline'), timestamp) AS pipeline_name,
        toStartOfHour(toDateTime64(min(timestamp) / 1000, 3)) AS window_start
    FROM network_events.network_events
    WHERE type = 'stream_trace'
      AND timestamp >= (toUnixTimestamp64Milli(now64(3)) - ${lookbackMs})
      AND JSONExtractString(toString(data), 'stream_id') != ''
    GROUP BY stream_id
)
SELECT
    pipeline_name,
    window_start,
    count() AS sessions
FROM session_pipeline
WHERE pipeline_name != ''
GROUP BY pipeline_name, window_start
ORDER BY window_start DESC, sessions DESC
FORMAT JSON
`.trim();
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ClickHousePipelineRow {
  pipeline_name: string;
  window_start: string;
  sessions: string | number;
}

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

function num(v: string | number | undefined): number {
  if (v === undefined || v === null) return 0;
  const n = typeof v === 'string' ? Number(v) : v;
  return Number.isFinite(n) ? n : 0;
}

export function aggregatePipelineUsage(
  rows: ClickHousePipelineRow[],
  limit: number,
): DashboardPipelineUsage[] {
  const byPipeline = new Map<string, number>();

  for (const row of rows) {
    const name = row.pipeline_name?.trim();
    if (!name || PIPELINE_DISPLAY[name] === null) continue;
    byPipeline.set(name, (byPipeline.get(name) ?? 0) + num(row.sessions));
  }

  return [...byPipeline.entries()]
    .map(([pipelineId, sessions]) => ({
      name: pipelineId,
      mins: 0,
      sessions,
      avgFps: 0,
      color: PIPELINE_COLOR[pipelineId] ?? DEFAULT_PIPELINE_COLOR,
    }))
    .sort((a, b) => b.sessions - a.sessions)
    .slice(0, limit);
}

// ---------------------------------------------------------------------------
// In-process TTL cache
// ---------------------------------------------------------------------------

let pipelinesCache: {
  key: string;
  expiresAt: number;
  promise: Promise<DashboardPipelineUsage[]>;
} | null = null;

async function fetchPipelineUsageUncached(
  lookbackHours: number,
  limit: number,
): Promise<DashboardPipelineUsage[]> {
  const baseUrl = process.env.CLICKHOUSE_URL?.trim();
  const user = process.env.CLICKHOUSE_USER?.trim();
  const password = process.env.CLICKHOUSE_PASSWORD?.trim();

  if (!baseUrl || !user || !password) {
    console.warn('[pipelines-ch] ClickHouse env not configured — returning empty');
    return [];
  }

  const lookbackMs = lookbackHours * 3_600_000;
  const url = `${baseUrl.replace(/\/$/, '')}/`;
  const auth = Buffer.from(`${user}:${password}`).toString('base64');
  const t0 = Date.now();

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'text/plain; charset=utf-8',
    },
    body: buildPipelineUsageSQL(lookbackMs),
    signal: AbortSignal.timeout(60_000),
    next: { revalidate: PIPELINES_CH_TTL_SECONDS },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(
      `[pipelines-ch] ClickHouse HTTP ${res.status}${text ? `: ${text.slice(0, 200)}` : ''}`
    );
  }

  const body = (await res.json()) as { data?: ClickHousePipelineRow[] };
  const data = body.data;
  if (!Array.isArray(data)) {
    throw new Error('[pipelines-ch] ClickHouse response missing data array');
  }

  const result = aggregatePipelineUsage(data, limit);
  console.log(
    `[pipelines-ch] fetched ${data.length} rows → ${result.length} pipelines ` +
    `(${lookbackHours}h window) in ${Date.now() - t0}ms`
  );
  return result;
}

export function fetchPipelineUsageFromClickHouse(
  lookbackHours: number = 24,
  limit: number = 50,
): Promise<DashboardPipelineUsage[]> {
  const now = Date.now();
  const cacheKey = `${lookbackHours}:${limit}`;
  if (pipelinesCache && pipelinesCache.key === cacheKey && pipelinesCache.expiresAt > now) {
    console.log(`[pipelines-ch] CACHE HIT (expires in ${Math.round((pipelinesCache.expiresAt - now) / 1000)}s)`);
    return pipelinesCache.promise;
  }

  console.log('[pipelines-ch] CACHE MISS — fetching upstream');
  const promise = fetchPipelineUsageUncached(lookbackHours, limit).catch((err) => {
    pipelinesCache = null;
    throw err;
  });
  pipelinesCache = { key: cacheKey, expiresAt: now + PIPELINES_CH_TTL_SECONDS * 1000, promise };
  return promise;
}
