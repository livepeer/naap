/**
 * Source Adapter: NaaP Orchestrator Discovery API
 *
 * Fetches from https://naap-api.cloudspe.com/v1/discover/orchestrators
 * via the gateway proxy (user-facing) or directly (cron internal mode).
 * Returns per-capability rows with score, liveness, and orchestrator URI.
 *
 * Two modes:
 *   - Gateway mode (default): routes through /api/v1/gw/naap-discover/*
 *   - Internal mode (ctx.internal): calls upstream directly (no auth needed)
 */

import type { SourceAdapter, FetchCtx, SourceFetchResult, NormalizedOrch } from './types';
import { resolveConnectorAuth } from './internal-resolve';

const GW_PATH = '/api/v1/gw/naap-discover/orchestrators';
const UPSTREAM_PATH = '/v1/discover/orchestrators';

function resolveGatewayUrl(requestUrl?: string): string {
  const origin =
    (requestUrl ? new URL(requestUrl).origin : undefined) ||
    process.env.NEXT_PUBLIC_APP_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : undefined) ||
    'http://localhost:3000';
  return new URL(GW_PATH, origin).toString();
}

function buildGatewayHeaders(ctx: FetchCtx): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${ctx.authToken}`,
  };
  if (ctx.cookieHeader) headers['cookie'] = ctx.cookieHeader;
  const bypassSecret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  if (bypassSecret) headers['x-vercel-protection-bypass'] = bypassSecret;
  return headers;
}

async function resolveUrlAndHeaders(ctx: FetchCtx): Promise<{ url: string; headers: Record<string, string> }> {
  if (ctx.internal) {
    const auth = await resolveConnectorAuth('naap-discover');
    if (auth) {
      return { url: `${auth.upstreamBaseUrl}${UPSTREAM_PATH}`, headers: auth.headers };
    }
    // Fallback: call upstream directly with no auth (public API)
    return { url: `https://naap-api.cloudspe.com${UPSTREAM_PATH}`, headers: {} };
  }
  return { url: resolveGatewayUrl(ctx.requestUrl), headers: buildGatewayHeaders(ctx) };
}

interface DiscoverRow {
  address: string;
  score: number;
  capabilities: string[];
  last_seen_ms: number;
  last_seen: string;
  recent_work: boolean;
}

/**
 * Split a discover-API capability string like "live-video-to-video/streamdiffusion-sdxl"
 * into a short capability name matching ClickHouse convention ("streamdiffusion-sdxl").
 * Falls back to the full string if no "/" present.
 */
function extractCapabilityName(raw: string): string {
  const idx = raw.lastIndexOf('/');
  return idx >= 0 ? raw.slice(idx + 1) : raw;
}

export const naapDiscoverAdapter: SourceAdapter = {
  kind: 'naap-discover',

  async fetchAll(ctx: FetchCtx): Promise<SourceFetchResult> {
    const t0 = Date.now();
    const { url, headers } = await resolveUrlAndHeaders(ctx);

    const res = await fetch(url, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Discover API failed (${res.status}): ${text.slice(0, 200)}`);
    }

    const json = await res.json();
    const rawRows: DiscoverRow[] = Array.isArray(json)
      ? json
      : Array.isArray(json?.data)
        ? json.data
        : [];

    const rows: NormalizedOrch[] = [];

    for (const r of rawRows) {
      const rawCaps = Array.isArray(r.capabilities) ? r.capabilities : [];
      if (rawCaps.length === 0) continue;
      const shortCaps = rawCaps.map(extractCapabilityName);
      rows.push({
        orchUri: r.address,
        capabilities: shortCaps,
        score: r.score,
        recentWork: r.recent_work,
        lastSeenMs: r.last_seen_ms,
      });
    }

    return {
      rows,
      raw: rawRows,
      stats: { ok: true, fetched: rows.length, durationMs: Date.now() - t0 },
    };
  },
};
