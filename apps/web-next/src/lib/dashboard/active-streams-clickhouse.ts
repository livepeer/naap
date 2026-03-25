/**
 * Active streams data from ClickHouse `semantic.stream_events`.
 *
 * Returns currently active streams (events within the last 3 minutes)
 * with their latest state, FPS, and duration information for the
 * Live Job Feed on the dashboard overview page.
 *
 * Fetches raw rows via the `livepeer-naap-analytics` managed connector in the
 * Service Gateway, then maps columns to the ActiveStreamRow shape.
 *
 * Caching is handled by the gateway's per-endpoint cacheTtl (10s).
 */

import { queryManagedConnector } from '@/lib/gateway/internal-client';

export const ACTIVE_STREAMS_TTL_SECONDS = 10;

const CONNECTOR_SLUG = 'livepeer-naap-analytics';

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
 * Check if the managed analytics connector is available.
 * Falls back to checking CLICKHOUSE_URL env var for backward compatibility.
 */
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
// Fetch via managed connector
// ---------------------------------------------------------------------------

export async function fetchActiveStreamsFromClickHouse(): Promise<ActiveStreamRow[]> {
  const t0 = Date.now();

  let response: Response;
  try {
    response = await queryManagedConnector(CONNECTOR_SLUG, '/active-streams');
  } catch (err) {
    console.warn('[active-streams-ch] Managed connector query failed:', err);
    return [];
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(
      `[active-streams-ch] ClickHouse HTTP ${response.status}${text ? `: ${text.slice(0, 200)}` : ''}`
    );
  }

  const body = (await response.json()) as { data?: ClickHouseStreamRow[] };
  const data = body.data;
  if (!Array.isArray(data)) {
    throw new Error('[active-streams-ch] ClickHouse response missing data array');
  }

  const rows = data.map(mapRow);
  console.log(`[active-streams-ch] fetched ${rows.length} active streams in ${Date.now() - t0}ms`);
  return rows;
}
