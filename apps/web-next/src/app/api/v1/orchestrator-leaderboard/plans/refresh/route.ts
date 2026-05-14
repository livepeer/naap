/**
 * POST /api/v1/orchestrator-leaderboard/plans/refresh
 *
 * Cron-triggered bulk refresh of all enabled discovery plans.
 * Protected by CRON_SECRET (same pattern as other Vercel Cron routes).
 */

export const runtime = 'nodejs';
export const maxDuration = 120;

import { NextRequest, NextResponse } from 'next/server';
import { refreshAllPlans } from '@/lib/orchestrator-leaderboard/refresh';
import { getAuthToken } from '@/lib/api/response';
import { resolveClickhouseGatewayQueryUrl } from '@/lib/orchestrator-leaderboard/query';

function authorized(request: NextRequest): boolean {
  const auth = request.headers.get('authorization');
  return Boolean(process.env.CRON_SECRET) && auth === `Bearer ${process.env.CRON_SECRET}`;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!authorized(request)) {
    return NextResponse.json(
      { success: false, error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } },
      { status: 401 },
    );
  }

  const authToken = getAuthToken(request) || process.env.CRON_SECRET || '';

  try {
    const result = await refreshAllPlans(authToken, request.url);
    return NextResponse.json({
      success: true,
      data: result,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Refresh failed';
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message } },
      { status: 500 },
    );
  }
}
