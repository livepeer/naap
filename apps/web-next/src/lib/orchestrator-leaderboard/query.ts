/**
 * Orchestrator Leaderboard — SQL Builder & ClickHouse Fetch
 *
 * Builds the leaderboard SQL with safe parameter substitution and fetches
 * results through the service gateway's clickhouse-query connector.
 * Integrates with the in-memory cache to avoid redundant ClickHouse queries.
 */

import type { ClickHouseLeaderboardRow, ClickHouseJSONResponse } from './types';
import { getCached, setCached } from './cache';

const MAX_QUERY_ROWS = 100;

const CAPABILITY_PATTERN = /^[a-zA-Z0-9_-]+$/;

const LEADERBOARD_SQL_TEMPLATE = `SELECT
    cap.orch_uri AS orch_uri,
    cap.gpu_name AS gpu_name,
    round(cap.gpu_mem_gb, 1) AS gpu_gb,
    cap.avail AS avail,
    cap.total_cap AS total_cap,
    cap.price_per_unit AS price_per_unit,
    round(lat.best_latency, 1) AS best_lat_ms,
    round(lat.avg_latency, 1) AS avg_lat_ms,
    round(stab.swing_ratio, 2) AS swap_ratio,
    round(stab.avg_avail, 1) AS avg_avail
FROM (
    SELECT
        orch_uri,
        gpu_name,
        round(gpu_memory_total_gbs, 1) AS gpu_mem_gb,
        argMax(capacity_available, timestamp_ts) AS avail,
        argMax(total_capacity, timestamp_ts) AS total_cap,
        argMax(price_per_unit, timestamp_ts) AS price_per_unit
    FROM semantic.network_capabilities
    WHERE timestamp_ts >= now() - INTERVAL 1 HOUR
      AND capability_name = '$CAPABILITY'
      AND warm_bool = 1
    GROUP BY orch_uri, gpu_name, gpu_memory_total_gbs
    HAVING avail > 0
) AS cap
LEFT JOIN (
    SELECT
        orchestrator_url,
        avg(avg_latency) AS avg_latency,
        min(best_latency) AS best_latency
    FROM semantic.gateway_latency_summary
    WHERE timestamp_hour_ts >= now() - INTERVAL 24 HOUR
    GROUP BY orchestrator_url
) AS lat ON cap.orch_uri = lat.orchestrator_url
LEFT JOIN (
    SELECT
        orch_uri,
        (max(capacity_available) - min(capacity_available))
            / greatest(argMax(total_capacity, timestamp_ts), 1) AS swing_ratio,
        avg(capacity_available) AS avg_avail
    FROM semantic.network_capabilities
    WHERE timestamp_ts >= now() - INTERVAL 1 HOUR
      AND capability_name = '$CAPABILITY'
      AND warm_bool = 1
    GROUP BY orch_uri
) AS stab ON cap.orch_uri = stab.orch_uri
ORDER BY
    lat.best_latency ASC NULLS LAST,
    stab.swing_ratio ASC NULLS LAST,
    cap.price_per_unit ASC
LIMIT $TOP_N
FORMAT JSON`;

export function validateCapability(capability: string): void {
  if (!capability || typeof capability !== 'string') {
    throw new Error('capability is required and must be a string');
  }
  if (!CAPABILITY_PATTERN.test(capability)) {
    throw new Error('capability must contain only alphanumeric characters, hyphens, and underscores');
  }
  if (capability.length > 128) {
    throw new Error('capability must be 128 characters or fewer');
  }
}

export function validateTopN(topN: unknown): number {
  const n = Number(topN);
  if (!Number.isInteger(n) || n < 1 || n > 1000) {
    throw new Error('topN must be an integer between 1 and 1000');
  }
  return n;
}

export function buildLeaderboardSQL(capability: string, topN: number): string {
  validateCapability(capability);
  const validTopN = validateTopN(topN);

  return LEADERBOARD_SQL_TEMPLATE
    .replace(/\$CAPABILITY/g, capability)
    .replace('$TOP_N', String(validTopN));
}

/**
 * Fetch leaderboard rows, using the in-memory cache when available.
 * Always queries for MAX_QUERY_ROWS to maximize cache reuse across
 * different topN requests.
 */
export async function fetchLeaderboard(
  capability: string,
  authToken: string
): Promise<{ rows: ClickHouseLeaderboardRow[]; fromCache: boolean; cachedAt: number }> {
  validateCapability(capability);

  const cached = getCached(capability);
  if (cached) {
    return { rows: cached.rows, fromCache: true, cachedAt: cached.cachedAt };
  }

  const sql = buildLeaderboardSQL(capability, MAX_QUERY_ROWS);
  const rows = await fetchFromClickHouse(sql, authToken);
  const now = Date.now();
  setCached(capability, rows);
  return { rows, fromCache: false, cachedAt: now };
}

async function fetchFromClickHouse(
  sql: string,
  authToken: string
): Promise<ClickHouseLeaderboardRow[]> {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
  const url = `${baseUrl}/api/v1/gw/clickhouse-query/query`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/plain',
      'Authorization': `Bearer ${authToken}`,
    },
    body: sql,
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`ClickHouse query failed (${res.status}): ${text.slice(0, 200)}`);
  }

  const json = await res.json();

  const chResponse = (json.data ?? json) as ClickHouseJSONResponse;
  return chResponse.data ?? [];
}
