/**
 * POST /api/v1/orchestrator-leaderboard/rank
 *
 * Accepts a filter JSON with capability and optional topN/filters/slaWeights.
 *
 * Resolution order:
 *   1. In-memory global dataset (populated by hourly cron from ALL sources)
 *   2. Direct ClickHouse query (for capabilities with metrics data)
 *   3. On-demand Discovery API fetch (for Discovery-only capabilities on cold instances)
 */

export const runtime = 'nodejs';
export const maxDuration = 30;

import { NextRequest, NextResponse } from 'next/server';
import { authorize } from '@/lib/gateway/authorize';
import { success } from '@/lib/api/response';
import { fetchLeaderboard } from '@/lib/orchestrator-leaderboard/query';
import { applyFilters, rerank, mapRow } from '@/lib/orchestrator-leaderboard/ranking';
import { getAuthToken } from '@/lib/api/response';
import { getGlobalDataset } from '@/lib/orchestrator-leaderboard/global-dataset';
import { naapDiscoverAdapter } from '@/lib/orchestrator-leaderboard/sources/naap-discover';
import type { LeaderboardRequest, ClickHouseLeaderboardRow } from '@/lib/orchestrator-leaderboard/types';

/**
 * On-demand fallback: fetch from Discovery API and extract rows matching
 * the requested capability. Used when the global dataset is cold and
 * ClickHouse has no data for this capability.
 */
async function fetchFromDiscoveryFallback(
  capability: string,
  authToken: string,
  requestUrl?: string,
  cookieHeader?: string | null,
): Promise<ClickHouseLeaderboardRow[]> {
  try {
    const { rows: normalizedRows } = await naapDiscoverAdapter.fetchAll({
      authToken,
      requestUrl,
      cookieHeader,
      internal: true,
    });

    const matched: ClickHouseLeaderboardRow[] = [];
    for (const orch of normalizedRows) {
      if (!orch.capabilities?.includes(capability)) continue;
      matched.push({
        orch_uri: orch.orchUri || '',
        gpu_name: orch.gpuName || '',
        gpu_gb: orch.gpuGb || 0,
        avail: orch.avail || 0,
        total_cap: orch.totalCap || 0,
        price_per_unit: orch.pricePerUnit || 0,
        best_lat_ms: orch.bestLatMs ?? null,
        avg_lat_ms: orch.avgLatMs ?? null,
        swap_ratio: orch.swapRatio ?? null,
        avg_avail: orch.avgAvail ?? null,
      });
    }
    return matched;
  } catch {
    return [];
  }
}

export async function POST(request: NextRequest): Promise<NextResponse | Response> {
  const auth = await authorize(request);
  if (!auth) {
    return NextResponse.json(
      { success: false, error: { code: 'UNAUTHORIZED', message: 'Missing or invalid authentication' } },
      { status: 401 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid JSON body' } },
      { status: 400 }
    );
  }

  if (
    !body ||
    typeof body !== 'object' ||
    Array.isArray(body) ||
    typeof (body as LeaderboardRequest).capability !== 'string' ||
    !(body as LeaderboardRequest).capability
  ) {
    return NextResponse.json(
      { success: false, error: { code: 'VALIDATION_ERROR', message: 'capability is required and must be a string' } },
      { status: 400 }
    );
  }

  if (!/^[a-zA-Z0-9._:-]+$/.test((body as LeaderboardRequest).capability)) {
    return NextResponse.json(
      { success: false, error: { code: 'VALIDATION_ERROR', message: 'capability contains invalid characters' } },
      { status: 400 }
    );
  }

  const validBody = body as LeaderboardRequest;
  const topN = validBody.topN ?? 10;
  if (!Number.isInteger(topN) || topN < 1 || topN > 1000) {
    return NextResponse.json(
      { success: false, error: { code: 'VALIDATION_ERROR', message: 'topN must be an integer between 1 and 1000' } },
      { status: 400 }
    );
  }

  const authToken = getAuthToken(request) || '';

  // 1. Try global dataset (has data from ALL sources including Discovery)
  let rows: ClickHouseLeaderboardRow[] = [];
  let fromCache = false;
  let cachedAt = Date.now();
  let source = 'none';

  const globalDs = getGlobalDataset();
  if (globalDs) {
    const dsRows = globalDs.capabilities[validBody.capability];
    if (dsRows && dsRows.length > 0) {
      rows = dsRows;
      fromCache = true;
      cachedAt = globalDs.refreshedAt;
      source = 'global-dataset';
    }
  }

  // 2. Fall back to direct ClickHouse query
  if (rows.length === 0) {
    try {
      const result = await fetchLeaderboard(
        validBody.capability,
        authToken,
        request.url,
        request.headers.get('cookie'),
      );
      if (result.rows.length > 0) {
        rows = result.rows;
        fromCache = result.fromCache;
        cachedAt = result.cachedAt;
        source = 'clickhouse';
      }
    } catch {
      // ClickHouse unavailable — continue to Discovery fallback
    }
  }

  // 3. Final fallback: on-demand Discovery fetch (for cold instances)
  if (rows.length === 0) {
    rows = await fetchFromDiscoveryFallback(
      validBody.capability,
      authToken,
      request.url,
      request.headers.get('cookie'),
    );
    if (rows.length > 0) {
      source = 'discovery-fallback';
      cachedAt = Date.now();
    }
  }

  const filtered = applyFilters(rows, validBody.filters);

  let data;
  if (validBody.slaWeights) {
    data = rerank(filtered, validBody.slaWeights).slice(0, topN);
  } else {
    data = filtered.slice(0, topN).map(mapRow);
  }

  const cacheAgeSeconds = Math.round((Date.now() - cachedAt) / 1000);

  const response = success(data);
  response.headers.set('Cache-Control', 'private, max-age=10');
  response.headers.set('X-Cache', fromCache ? 'HIT' : 'MISS');
  response.headers.set('X-Cache-Age', String(cacheAgeSeconds));
  response.headers.set('X-Data-Freshness', new Date(cachedAt).toISOString());
  response.headers.set('X-Data-Source', source);
  return response;
}
