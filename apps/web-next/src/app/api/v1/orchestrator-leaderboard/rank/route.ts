/**
 * POST /api/v1/orchestrator-leaderboard/rank
 *
 * Accepts a filter JSON with capability and optional topN/filters/slaWeights.
 * First tries the in-memory global dataset (populated by the resolver from
 * ALL sources including Discovery). Falls back to a direct ClickHouse query
 * if the global dataset doesn't have rows for the requested capability.
 */

export const runtime = 'nodejs';
export const maxDuration = 30;

import { NextRequest, NextResponse } from 'next/server';
import { authorize } from '@/lib/gateway/authorize';
import { success, errors } from '@/lib/api/response';
import { fetchLeaderboard } from '@/lib/orchestrator-leaderboard/query';
import { applyFilters, rerank, mapRow } from '@/lib/orchestrator-leaderboard/ranking';
import { getAuthToken } from '@/lib/api/response';
import { getGlobalDataset } from '@/lib/orchestrator-leaderboard/global-dataset';
import type { LeaderboardRequest } from '@/lib/orchestrator-leaderboard/types';
import type { ClickHouseLeaderboardRow } from '@/lib/orchestrator-leaderboard/types';

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

  // Try global dataset first (has data from ALL sources including Discovery)
  let rows: ClickHouseLeaderboardRow[] | null = null;
  let fromCache = false;
  let cachedAt = Date.now();

  const globalDs = getGlobalDataset();
  if (globalDs) {
    const dsRows = globalDs.capabilities[validBody.capability];
    if (dsRows && dsRows.length > 0) {
      rows = dsRows;
      fromCache = true;
      cachedAt = globalDs.refreshedAt;
    }
  }

  // Fall back to direct ClickHouse query if global dataset doesn't have this capability
  if (!rows) {
    try {
      const result = await fetchLeaderboard(
        validBody.capability,
        authToken,
        request.url,
        request.headers.get('cookie'),
      );
      rows = result.rows;
      fromCache = result.fromCache;
      cachedAt = result.cachedAt;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'ClickHouse query failed';
      const isTimeout = message.includes('timeout') || message.includes('abort');
      return NextResponse.json(
        { success: false, error: { code: isTimeout ? 'GATEWAY_TIMEOUT' : 'UPSTREAM_ERROR', message } },
        { status: isTimeout ? 504 : 502 }
      );
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
  return response;
}
