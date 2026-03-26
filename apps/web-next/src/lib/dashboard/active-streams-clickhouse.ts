/**
 * Active streams data from ClickHouse `semantic.stream_events`.
 *
 * Returns currently active streams (events within the last 3 minutes)
 * with their latest state, FPS, and duration information for the
 * Live Job Feed on the dashboard overview page.
 *
 * Env (server-only): CLICKHOUSE_URL, CLICKHOUSE_USER, CLICKHOUSE_PASSWORD
 *
 * Caching: two-layer strategy (same as gpu-capacity-clickhouse.ts):
 *   1. In-process TTL cache (works in dev where Next Data Cache is off)
 *   2. next: { revalidate } on the outbound fetch (production Data Cache)
 */

export const ACTIVE_STREAMS_TTL_SECONDS = 10;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ActiveStreamRow {
  id: string;
  pipeline: string;
  gateway: string;
  orchestratorUrl: string;
  state: string;
  inputFps: number;
  outputFps: number;
  firstSeen: string;
  lastSeen: string;
  durationSeconds: number;
  runningFor: string;
}

interface ClickHouseStreamRow {
  source: string;
  id: string;
  pipeline: string;
  gateway: string;
  orchestrator_url: string;
  state: string;
  input_fps: number;
  output_fps: number;
  first_ever: string;
  last_seen: string;
  duration_s: number;
  running_for: string;
}

/**
 * Static SQL for active streams. The optional pipeline filter is handled via a
 * ClickHouse parameterized query (`{pipeline_filter:String}`). When no env
 * filter is set the caller passes `%` so `ILIKE '%'` matches all rows.
 *
 * @see https://clickhouse.com/docs/interfaces/http#cli-queries-with-parameters
 */
const ACTIVE_STREAMS_SQL = `
WITH active_streams AS (
  SELECT DISTINCT stream_id
  FROM semantic.stream_events
  WHERE event_timestamp_ts >= now() - INTERVAL 3 MINUTE
    AND stream_id != ''
    AND pipeline != ''
    AND pipeline ILIKE {pipeline_filter:String}
),
latest AS (
  SELECT
    e.stream_id AS stream_id,
    max(e.event_timestamp_ts) AS last_seen,
    argMax(e.input_fps, e.event_timestamp_ts) AS last_input_fps,
    argMax(e.output_fps, e.event_timestamp_ts) AS last_output_fps,
    argMaxIf(e.state, e.event_timestamp_ts, e.state != '') AS latest_state
  FROM semantic.stream_events e
  INNER JOIN active_streams a ON a.stream_id = e.stream_id
  GROUP BY e.stream_id
),
metadata AS (
  SELECT
    e.stream_id AS stream_id,
    argMaxIf(e.pipeline, e.event_timestamp_ts, e.pipeline != '') AS pipeline,
    argMaxIf(e.gateway, e.event_timestamp_ts, e.gateway != '') AS gateway,
    argMaxIf(e.orchestrator_url, e.event_timestamp_ts, e.orchestrator_url != '') AS orchestrator_url
  FROM semantic.stream_events e
  INNER JOIN active_streams a ON a.stream_id = e.stream_id
  GROUP BY e.stream_id
),
first_seen AS (
  SELECT
    e.stream_id AS stream_id,
    min(e.event_timestamp_ts) AS first_ever
  FROM semantic.stream_events e
  INNER JOIN active_streams a ON a.stream_id = e.stream_id
  GROUP BY e.stream_id
)
SELECT
  'stream' AS source,
  a.stream_id AS id,
  ifNull(m.pipeline, '') AS pipeline,
  ifNull(m.gateway, '') AS gateway,
  ifNull(m.orchestrator_url, '') AS orchestrator_url,
  ifNull(l.latest_state, '') AS state,
  round(l.last_input_fps, 1) AS input_fps,
  round(l.last_output_fps, 1) AS output_fps,
  f.first_ever AS first_ever,
  l.last_seen AS last_seen,
  dateDiff('second', f.first_ever, l.last_seen) AS duration_s,
  concat(
    toString(intDiv(dateDiff('second', f.first_ever, l.last_seen), 3600)),
    'h ',
    toString(intDiv(dateDiff('second', f.first_ever, l.last_seen) % 3600, 60)),
    'm ',
    toString(dateDiff('second', f.first_ever, l.last_seen) % 60),
    's'
  ) AS running_for
FROM active_streams a
LEFT JOIN latest l ON l.stream_id = a.stream_id
LEFT JOIN metadata m ON m.stream_id = a.stream_id
LEFT JOIN first_seen f ON f.stream_id = a.stream_id
ORDER BY f.first_ever DESC
FORMAT JSON
`.trim();

export function isClickHouseEnvConfiguredForJobFeed(): boolean {
  const baseUrl = process.env.CLICKHOUSE_URL?.trim();
  const user = process.env.CLICKHOUSE_USER?.trim();
  const password = process.env.CLICKHOUSE_PASSWORD?.trim();
  return Boolean(baseUrl && user && password);
}

// ---------------------------------------------------------------------------
// Row mapping
// ---------------------------------------------------------------------------

function mapRow(row: ClickHouseStreamRow): ActiveStreamRow {
  return {
    id: row.id,
    pipeline: row.pipeline,
    gateway: row.gateway,
    orchestratorUrl: row.orchestrator_url,
    state: row.state,
    inputFps: Number(row.input_fps) || 0,
    outputFps: Number(row.output_fps) || 0,
    firstSeen: row.first_ever,
    lastSeen: row.last_seen,
    durationSeconds: Number(row.duration_s) || 0,
    runningFor: row.running_for,
  };
}

// ---------------------------------------------------------------------------
// In-process TTL cache
// ---------------------------------------------------------------------------

let cache: { expiresAt: number; promise: Promise<ActiveStreamRow[]> } | null = null;

async function fetchUncached(): Promise<ActiveStreamRow[]> {
  const baseUrl = process.env.CLICKHOUSE_URL?.trim();
  const user = process.env.CLICKHOUSE_USER?.trim();
  const password = process.env.CLICKHOUSE_PASSWORD?.trim();

  if (!baseUrl || !user || !password) {
    console.warn('[active-streams-ch] ClickHouse env not configured — returning empty');
    return [];
  }

  const pipelineFilter = process.env.JOB_FEED_PIPELINE_FILTER?.trim() || '%';
  const params = new URLSearchParams({ param_pipeline_filter: pipelineFilter });
  const url = `${baseUrl.replace(/\/$/, '')}/?${params}`;
  const auth = Buffer.from(`${user}:${password}`).toString('base64');
  const t0 = Date.now();

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'text/plain; charset=utf-8',
    },
    body: ACTIVE_STREAMS_SQL,
    signal: AbortSignal.timeout(15_000),
    next: { revalidate: ACTIVE_STREAMS_TTL_SECONDS },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(
      `[active-streams-ch] ClickHouse HTTP ${res.status}${text ? `: ${text.slice(0, 200)}` : ''}`
    );
  }

  const body = (await res.json()) as { data?: ClickHouseStreamRow[] };
  const data = body.data;
  if (!Array.isArray(data)) {
    throw new Error('[active-streams-ch] ClickHouse response missing data array');
  }

  const rows = data.map(mapRow);
  console.log(`[active-streams-ch] fetched ${rows.length} active streams in ${Date.now() - t0}ms`);
  return rows;
}

export function fetchActiveStreamsFromClickHouse(): Promise<ActiveStreamRow[]> {
  const now = Date.now();
  if (cache && cache.expiresAt > now) {
    return cache.promise;
  }

  const promise = fetchUncached().catch((err) => {
    cache = null;
    throw err;
  });
  cache = { expiresAt: now + ACTIVE_STREAMS_TTL_SECONDS * 1000, promise };
  return promise;
}
