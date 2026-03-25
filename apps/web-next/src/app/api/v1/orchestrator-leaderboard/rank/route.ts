/**
 * POST /api/v1/orchestrator-leaderboard/rank
 *
 * Accepts a filter JSON with capability and optional topN/filters/slaWeights,
 * queries ClickHouse via the gateway connector (with server-side caching),
 * and returns a ranked list of orchestrator URLs with metrics.
 */

export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { authorize } from '@/lib/gateway/authorize';
import { success, errors } from '@/lib/api/response';
import { fetchLeaderboard } from '@/lib/orchestrator-leaderboard/query';
import { applyFilters, rerank, mapRow } from '@/lib/orchestrator-leaderboard/ranking';
import { getAuthToken } from '@/lib/api/response';
import type { LeaderboardRequest } from '@/lib/orchestrator-leaderboard/types';

export async function POST(request: NextRequest): Promise<NextResponse | Response> {
  const auth = await authorize(request);
  if (!auth) {
    return NextResponse.json(
      { success: false, error: { code: 'UNAUTHORIZED', message: 'Missing or invalid authentication' } },
      { status: 401 }
    );
  }

  let body: LeaderboardRequest;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid JSON body' } },
      { status: 400 }
    );
  }

  if (!body.capability || typeof body.capability !== 'string') {
    return NextResponse.json(
      { success: false, error: { code: 'VALIDATION_ERROR', message: 'capability is required and must be a string' } },
      { status: 400 }
    );
  }

  if (!/^[a-zA-Z0-9_-]+$/.test(body.capability)) {
    return NextResponse.json(
      { success: false, error: { code: 'VALIDATION_ERROR', message: 'capability must contain only alphanumeric characters, hyphens, and underscores' } },
      { status: 400 }
    );
  }

  const topN = body.topN ?? 10;
  if (!Number.isInteger(topN) || topN < 1 || topN > 1000) {
    return NextResponse.json(
      { success: false, error: { code: 'VALIDATION_ERROR', message: 'topN must be an integer between 1 and 1000' } },
      { status: 400 }
    );
  }

  const authToken = getAuthToken(request) || '';

  let result;
  try {
    result = await fetchLeaderboard(body.capability, authToken);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'ClickHouse query failed';
    const isTimeout = message.includes('timeout') || message.includes('abort');
    return NextResponse.json(
      { success: false, error: { code: isTimeout ? 'GATEWAY_TIMEOUT' : 'UPSTREAM_ERROR', message } },
      { status: isTimeout ? 504 : 502 }
    );
  }

  const filtered = applyFilters(result.rows, body.filters);

  let data;
  if (body.slaWeights) {
    data = rerank(filtered, body.slaWeights).slice(0, topN);
  } else {
    data = filtered.slice(0, topN).map(mapRow);
  }

  const cacheAgeSeconds = Math.round((Date.now() - result.cachedAt) / 1000);

  const response = success(data);
  response.headers.set('Cache-Control', 'public, max-age=10');
  response.headers.set('X-Cache', result.fromCache ? 'HIT' : 'MISS');
  response.headers.set('X-Cache-Age', String(cacheAgeSeconds));
  response.headers.set('X-Data-Freshness', new Date(result.cachedAt).toISOString());
  return response;
}
