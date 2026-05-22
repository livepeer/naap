/**
 * POST /api/v1/orchestrator-leaderboard/rank
 *
 * Accepts a filter JSON with capability and optional topN/filters/slaWeights.
 * Reads orchestrator rows from the persistent LeaderboardDatasetRow table
 * (populated by the hourly cron refresh from all configured data sources).
 */

export const runtime = 'nodejs';
export const maxDuration = 30;

import { NextRequest, NextResponse } from 'next/server';
import { authorize } from '@/lib/gateway/authorize';
import { success } from '@/lib/api/response';
import { applyFilters, rerank, mapRow } from '@/lib/orchestrator-leaderboard/ranking';
import { getRowsForCapability } from '@/lib/orchestrator-leaderboard/global-dataset';
import type { LeaderboardRequest } from '@/lib/orchestrator-leaderboard/types';

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

  if (!/^[a-zA-Z0-9._:\/\-]+$/.test((body as LeaderboardRequest).capability)) {
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

  const rows = await getRowsForCapability(validBody.capability);
  const filtered = applyFilters(rows, validBody.filters);

  let data;
  if (validBody.slaWeights) {
    data = rerank(filtered, validBody.slaWeights).slice(0, topN);
  } else {
    data = filtered.slice(0, topN).map(mapRow);
  }

  const response = success(data);
  response.headers.set('Cache-Control', 'private, max-age=10');
  return response;
}
