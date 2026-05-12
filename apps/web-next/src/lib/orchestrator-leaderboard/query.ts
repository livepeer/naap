/**
 * Orchestrator Leaderboard — SQL Builder & ClickHouse Fetch
 *
 * Builds the leaderboard SQL with safe parameter substitution and fetches
 * results either directly against ClickHouse (CLICKHOUSE_URL + USER +
 * PASSWORD) or through the service gateway's clickhouse-query connector.
 * Integrates with the in-memory cache
 * to avoid redundant ClickHouse queries.
 */

import type { ClickHouseLeaderboardRow, ClickHouseJSONResponse } from './types';
import { getCached, setCached } from './cache';

const MAX_QUERY_ROWS = 1000;

const CAPABILITY_PATTERN = /^[a-zA-Z0-9_-]+$/;

const CLICKHOUSE_GW_PATH = '/api/v1/gw/clickhouse-query/query';

const CLICKHOUSE_TIMEOUT_MS = 15_000;

function getEnv(name: string): string {
  return process.env[name]?.trim() ?? '';
}

function getDirectClickhouseConfig(): { url: string; user: string; password: string } | null {
  const url = getEnv('CLICKHOUSE_URL');
  const user = getEnv('CLICKHOUSE_USER');
  const password = getEnv('CLICKHOUSE_PASSWORD');

  if (!url && !user && !password) return null;
  if (!url || !user || !password) {
    throw new Error(
      'CLICKHOUSE_URL, CLICKHOUSE_USER, and CLICKHOUSE_PASSWORD must all be set for direct ClickHouse access',
    );
  }

  return { url, user, password };
}

function resolveDirectClickhouseUrl(rawUrl: string): string {
  return new URL('/', rawUrl).toString();
}

function buildBasicAuthHeader(user: string, password: string): string {
  return `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`;
}

/**
 * When `CLICKHOUSE_URL`, `CLICKHOUSE_USER`, and `CLICKHOUSE_PASSWORD` are all
 * set, returns direct ClickHouse HTTP endpoint with Basic auth. Otherwise
 * returns the in-app gateway proxy URL (Bearer auth added by
 * {@link buildOrchestratorClickhouseFetchParams}).
 */
export function resolveClickhouseQueryTarget(requestUrl?: string): {
  url: string;
  headers: Record<string, string>;
  mode: 'direct' | 'gateway';
} {
  const direct = getDirectClickhouseConfig();
  if (direct) {
    return {
      url: resolveDirectClickhouseUrl(direct.url),
      headers: {
        'Content-Type': 'text/plain',
        Authorization: buildBasicAuthHeader(direct.user, direct.password),
      },
      mode: 'direct',
    };
  }

  return {
    url: resolveClickhouseGatewayQueryUrl(requestUrl),
    headers: {
      'Content-Type': 'text/plain',
    },
    mode: 'gateway',
  };
}

/**
 * URL and headers for a leaderboard ClickHouse POST (SQL body as text/plain).
 * Direct mode uses env credentials only; gateway mode adds Bearer, optional
 * cookie, and Vercel protection bypass.
 */
export function buildOrchestratorClickhouseFetchParams(
  authToken: string,
  requestUrl?: string,
  cookieHeader?: string | null,
): { url: string; headers: Record<string, string> } {
  const target = resolveClickhouseQueryTarget(requestUrl);
  const headers = { ...target.headers };

  if (target.mode === 'gateway') {
    headers.Authorization = `Bearer ${authToken}`;
    if (cookieHeader) {
      headers['cookie'] = cookieHeader;
    }
    const bypassSecret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
    if (bypassSecret) {
      headers['x-vercel-protection-bypass'] = bypassSecret;
    }
  }

  return { url: target.url, headers };
}

/**
 * Base URL for server-side calls to the gateway ClickHouse proxy.
 * Prefer the incoming request origin so dev servers on non-3000 ports and
 * preview deployments hit the same app instance (NEXT_PUBLIC_APP_URL alone
 * often stays localhost:3000 from .env while the dev server runs elsewhere).
 */
export function resolveClickhouseGatewayQueryUrl(requestUrl?: string): string {
  const origin =
    (requestUrl ? new URL(requestUrl).origin : undefined) ||
    process.env.NEXT_PUBLIC_APP_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : undefined) ||
    'http://localhost:3000';
  return new URL(CLICKHOUSE_GW_PATH, origin).toString();
}

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
 *
 * @param cookieHeader - forward `cookie` from the incoming request so
 *   server→server calls pass Vercel deployment-protection JWT.
 */
export async function fetchLeaderboard(
  capability: string,
  authToken: string,
  requestUrl?: string,
  cookieHeader?: string | null,
): Promise<{ rows: ClickHouseLeaderboardRow[]; fromCache: boolean; cachedAt: number }> {
  validateCapability(capability);

  const cached = getCached(capability);
  if (cached) {
    return { rows: cached.rows, fromCache: true, cachedAt: cached.cachedAt };
  }

  const sql = buildLeaderboardSQL(capability, MAX_QUERY_ROWS);
  const rows = await fetchFromClickHouse(sql, authToken, requestUrl, cookieHeader);
  const now = Date.now();
  setCached(capability, rows);
  return { rows, fromCache: false, cachedAt: now };
}

async function fetchFromClickHouse(
  sql: string,
  authToken: string,
  requestUrl?: string,
  cookieHeader?: string | null,
): Promise<ClickHouseLeaderboardRow[]> {
  const { url, headers } = buildOrchestratorClickhouseFetchParams(
    authToken,
    requestUrl,
    cookieHeader,
  );

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: sql,
    signal: AbortSignal.timeout(CLICKHOUSE_TIMEOUT_MS),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    if (process.env.NODE_ENV === 'development') {
      console.error(
        '[orchestrator-leaderboard] ClickHouse request failed',
        JSON.stringify({ url, status: res.status, bodyPreview: text.slice(0, 400) }),
      );
    }
    throw new Error(`ClickHouse query failed (${res.status}): ${text.slice(0, 200)}`);
  }

  const json = await res.json();

  if (Array.isArray(json)) {
    return json;
  }

  if (Array.isArray((json as ClickHouseJSONResponse).data)) {
    return (json as ClickHouseJSONResponse).data;
  }

  const wrapped = (json as { data?: ClickHouseJSONResponse }).data;
  if (wrapped && Array.isArray(wrapped.data)) {
    return wrapped.data;
  }

  throw new Error('Unexpected ClickHouse response shape');
}
