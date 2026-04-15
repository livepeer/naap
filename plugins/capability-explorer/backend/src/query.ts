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
    c.capability_name,
    any(c.pipeline_type)                                      AS pipeline_type,
    uniq(c.orch_uri)                                          AS orchestrators,
    uniq(concat(c.orch_uri, c.gpu_id))                        AS gpus,
    sum(c.cap)                                                AS total_slots,
    sum(c.in_use)                                             AS used_slots,
    sum(c.cap) - sum(c.in_use)                                AS free_slots,
    round((sum(c.cap) - sum(c.in_use)) / sum(c.cap) * 100, 1) AS free_pct,
    round(avg(c.price_per_unit), 2)                           AS mean_price_per_pixel_wei,
    round(min(c.price_per_unit), 2)                           AS min_price_per_pixel_wei,
    round(max(c.price_per_unit), 2)                           AS max_price_per_pixel_wei,
    round(avg(l.avg_latency), 1)                              AS avg_latency_ms
FROM (
    SELECT
        capability_name,
        any(pipeline_type)    AS pipeline_type,
        orch_uri,
        gpu_id,
        max(total_capacity)   AS cap,
        max(capacity_in_use)  AS in_use,
        max(price_per_unit)   AS price_per_unit
    FROM semantic.network_capabilities
    WHERE timestamp_ts >= now() - INTERVAL 4 HOUR
      AND total_capacity < 1000
      AND total_capacity > 0
    GROUP BY capability_name, orch_uri, gpu_id
) AS c
LEFT JOIN (
    SELECT orchestrator_url,
           avg(avg_latency) AS avg_latency
    FROM semantic.gateway_latency_summary
    WHERE timestamp_hour_ts >= now() - INTERVAL 4 HOUR
    GROUP BY orchestrator_url
) AS l
    ON l.orchestrator_url = c.orch_uri
GROUP BY c.capability_name
ORDER BY gpus DESC
FORMAT JSON`;
}

export function buildFiltersSQL(): string {
  return `SELECT DISTINCT capability_name
FROM semantic.network_capabilities
WHERE timestamp_ts >= now() - INTERVAL 4 HOUR
  AND total_capacity > 0
  AND total_capacity < 1000
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
