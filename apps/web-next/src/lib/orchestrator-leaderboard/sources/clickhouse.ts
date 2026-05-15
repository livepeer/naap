/**
 * Source Adapter: ClickHouse Query
 *
 * Wraps the existing leaderboard SQL + gateway proxy path behind the
 * SourceAdapter interface. Returns per-capability orchestrator rows with
 * GPU info, latency, swap-ratio, availability, and price.
 *
 * Supports two modes:
 *   - Gateway mode (default): routes through /api/v1/gw/clickhouse-query/*
 *   - Internal mode (ctx.internal): resolves connector secrets via Prisma
 *     and calls ClickHouse upstream directly (for cron jobs).
 */

import type { SourceAdapter, FetchCtx, SourceFetchResult, NormalizedOrch } from './types';
import type { ClickHouseLeaderboardRow, ClickHouseJSONResponse } from '../types';
import { resolveClickhouseGatewayQueryUrl, buildLeaderboardSQL } from '../query';
import { resolveConnectorAuth } from './internal-resolve';

const MAX_QUERY_ROWS = 1000;

const CAPABILITIES_SQL = `SELECT DISTINCT capability_name
FROM semantic.network_capabilities
WHERE timestamp_ts >= now() - INTERVAL 1 HOUR
  AND warm_bool = 1
ORDER BY capability_name
FORMAT JSON`;

const FALLBACK_CAPABILITIES = [
  'noop',
  'streamdiffusion',
  'streamdiffusion-sdxl',
  'streamdiffusion-sdxl-v2v',
];

function buildGatewayHeaders(ctx: FetchCtx): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'text/plain',
    Authorization: `Bearer ${ctx.authToken}`,
  };
  if (ctx.cookieHeader) headers['cookie'] = ctx.cookieHeader;
  const bypassSecret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  if (bypassSecret) headers['x-vercel-protection-bypass'] = bypassSecret;
  return headers;
}

async function resolveUrlAndHeaders(ctx: FetchCtx): Promise<{ url: string; headers: Record<string, string> }> {
  if (ctx.internal) {
    const auth = await resolveConnectorAuth('clickhouse-query');
    if (!auth) throw new Error('clickhouse-query connector not found or not published');
    return {
      url: `${auth.upstreamBaseUrl}/`,
      headers: { ...auth.headers, 'Content-Type': 'text/plain' },
    };
  }
  return {
    url: resolveClickhouseGatewayQueryUrl(ctx.requestUrl),
    headers: buildGatewayHeaders(ctx),
  };
}

async function fetchCapabilities(ctx: FetchCtx): Promise<string[]> {
  try {
    const { url, headers } = await resolveUrlAndHeaders(ctx);
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: CAPABILITIES_SQL,
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`ClickHouse query failed (${res.status})`);
    const json = await res.json();
    const chData = (json.data ?? json) as { data?: Array<{ capability_name: string }> };
    return (chData.data ?? []).map((row: { capability_name: string }) => row.capability_name);
  } catch {
    return FALLBACK_CAPABILITIES;
  }
}

function parseChRows(json: unknown): ClickHouseLeaderboardRow[] {
  if (Array.isArray(json)) return json;
  if (Array.isArray((json as ClickHouseJSONResponse).data)) {
    return (json as ClickHouseJSONResponse).data;
  }
  const wrapped = (json as { data?: ClickHouseJSONResponse }).data;
  if (wrapped && Array.isArray(wrapped.data)) return wrapped.data;
  throw new Error('Unexpected ClickHouse response shape');
}

function chRowToNormalized(r: ClickHouseLeaderboardRow, capability: string): NormalizedOrch {
  return {
    orchUri: String(r.orch_uri ?? ''),
    gpuName: String(r.gpu_name ?? ''),
    gpuGb: Number(r.gpu_gb) || 0,
    avail: Number(r.avail) || 0,
    totalCap: Number(r.total_cap) || 0,
    pricePerUnit: Number(r.price_per_unit) || 0,
    bestLatMs: r.best_lat_ms != null ? Number(r.best_lat_ms) : null,
    avgLatMs: r.avg_lat_ms != null ? Number(r.avg_lat_ms) : null,
    swapRatio: r.swap_ratio != null ? Number(r.swap_ratio) : null,
    avgAvail: r.avg_avail != null ? Number(r.avg_avail) : null,
    capabilities: [capability],
  };
}

export const clickhouseAdapter: SourceAdapter = {
  kind: 'clickhouse-query',

  async fetchAll(ctx: FetchCtx): Promise<SourceFetchResult> {
    const t0 = Date.now();
    const capabilities = await fetchCapabilities(ctx);
    const { url, headers } = await resolveUrlAndHeaders(ctx);

    const allRows: NormalizedOrch[] = [];
    const rawCaps: Record<string, ClickHouseLeaderboardRow[]> = {};

    for (const cap of capabilities) {
      try {
        const sql = buildLeaderboardSQL(cap, MAX_QUERY_ROWS);
        const res = await fetch(url, {
          method: 'POST',
          headers,
          body: sql,
          signal: AbortSignal.timeout(15_000),
        });
        if (!res.ok) {
          rawCaps[cap] = [];
          continue;
        }
        const json = await res.json();
        const rows = parseChRows(json);
        rawCaps[cap] = rows;
        for (const r of rows) {
          allRows.push(chRowToNormalized(r, cap));
        }
      } catch {
        rawCaps[cap] = [];
      }
    }

    return {
      rows: allRows,
      raw: rawCaps,
      stats: { ok: true, fetched: allRows.length, durationMs: Date.now() - t0 },
    };
  },
};
