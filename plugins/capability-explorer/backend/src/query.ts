import type { HandlerContext, ClickHouseJSONResponse } from './types.js';

const CLICKHOUSE_GW_PATH = '/api/v1/gw/clickhouse-query/query';

export function resolveClickhouseGatewayQueryUrl(requestUrl?: string): string {
  const origin =
    (requestUrl ? new URL(requestUrl).origin : undefined) ||
    process.env.NEXT_PUBLIC_APP_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : undefined) ||
    'http://localhost:3000';
  return new URL(CLICKHOUSE_GW_PATH, origin).toString();
}

export function buildCapabilitySummarySQL(): string {
  return `SELECT
    capability_name,
    any(pipeline_type) AS pipeline_type,
    count(*) AS gpu_count,
    count(DISTINCT orch_uri) AS orch_count,
    sum(avail) AS total_capacity,
    round(avg(price_per_unit), 2) AS avg_price,
    min(price_per_unit) AS min_price,
    max(price_per_unit) AS max_price
FROM (
    SELECT
        capability_name,
        orch_uri,
        gpu_name,
        argMax(pipeline_type, timestamp_ts) AS pipeline_type,
        argMax(capacity_available, timestamp_ts) AS avail,
        argMax(price_per_unit, timestamp_ts) AS price_per_unit
    FROM semantic.network_capabilities
    WHERE timestamp_ts >= now() - INTERVAL 1 HOUR
      AND warm_bool = 1
    GROUP BY capability_name, orch_uri, gpu_name
    HAVING avail > 0
)
GROUP BY capability_name
ORDER BY capability_name
FORMAT JSON`;
}

export function buildLatencySQL(): string {
  return `SELECT
    cap.capability_name AS capability_name,
    round(avg(lat.avg_latency), 1) AS avg_latency,
    round(min(lat.best_latency), 1) AS best_latency
FROM (
    SELECT DISTINCT capability_name, orch_uri
    FROM semantic.network_capabilities
    WHERE timestamp_ts >= now() - INTERVAL 1 HOUR
      AND warm_bool = 1
) AS cap
INNER JOIN (
    SELECT
        orchestrator_url,
        avg(avg_latency) AS avg_latency,
        min(best_latency) AS best_latency
    FROM semantic.gateway_latency_summary
    WHERE timestamp_hour_ts >= now() - INTERVAL 24 HOUR
    GROUP BY orchestrator_url
) AS lat ON cap.orch_uri = lat.orchestrator_url
GROUP BY cap.capability_name
ORDER BY cap.capability_name
FORMAT JSON`;
}

export function buildFiltersSQL(): string {
  return `SELECT DISTINCT capability_name
FROM semantic.network_capabilities
WHERE timestamp_ts >= now() - INTERVAL 1 HOUR
  AND warm_bool = 1
ORDER BY capability_name
FORMAT JSON`;
}

export async function fetchFromClickHouse<T>(
  sql: string,
  ctx: HandlerContext,
): Promise<T[]> {
  const url = resolveClickhouseGatewayQueryUrl(ctx.requestUrl);

  const headers: Record<string, string> = {
    'Content-Type': 'text/plain',
    'Authorization': `Bearer ${ctx.authToken}`,
  };

  if (ctx.cookieHeader) {
    headers['cookie'] = ctx.cookieHeader;
  }

  const bypassSecret = typeof process !== 'undefined'
    ? process.env?.VERCEL_AUTOMATION_BYPASS_SECRET
    : undefined;
  if (bypassSecret) {
    headers['x-vercel-protection-bypass'] = bypassSecret;
  }

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: sql,
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`ClickHouse query failed (${res.status}): ${text.slice(0, 200)}`);
  }

  const json = await res.json();

  if (Array.isArray(json)) return json;

  if (Array.isArray((json as ClickHouseJSONResponse<T>).data)) {
    return (json as ClickHouseJSONResponse<T>).data;
  }

  const wrapped = (json as { data?: ClickHouseJSONResponse<T> }).data;
  if (wrapped && Array.isArray(wrapped.data)) {
    return wrapped.data;
  }

  throw new Error('Unexpected ClickHouse response shape');
}
