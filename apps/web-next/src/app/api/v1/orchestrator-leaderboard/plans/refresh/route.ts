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
import { verifyCronAuth } from '@/lib/orchestrator-leaderboard/cron-auth';

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!verifyCronAuth(request)) {
    return NextResponse.json(
      { success: false, error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } },
      { status: 401 },
    );
  }

  try {
    const result = await refreshAllPlans();
    return NextResponse.json({
      success: true,
      data: result,
    });
  } catch (err) {
    console.error('[plans/refresh] refreshAllPlans failed:', err);
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
      { status: 500 },
    );
  }
}
