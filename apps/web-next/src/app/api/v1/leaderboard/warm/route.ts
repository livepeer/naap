// Leaderboard Cache Warmer
// GET /api/v1/leaderboard/warm
//
// Populates both the in-process memCache and Next.js fetch cache for all
// leaderboard endpoints using the same code path as the dashboard resolvers.
// Called by:
//   - Vercel cron (every ~50 min, before the 1hr TTL expires)
//   - Manual invocation for debugging
//
// Auth: CRON_SECRET (same pattern as /api/v1/gw/admin/health/check).

export const runtime = 'nodejs';
export const maxDuration = 120;

import { NextRequest, NextResponse } from 'next/server';
import { warmDashboardCaches } from '@/lib/dashboard/raw-data';

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get('authorization');
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await warmDashboardCaches();
    return NextResponse.json({
      warmed: 3,
      results: [
        { target: 'network/demand', ok: true, rows: result.demand.rows },
        { target: 'sla/compliance', ok: true, rows: result.sla.rows },
        { target: 'pipelines', ok: true, count: result.pipelines.count },
      ],
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    return NextResponse.json(
      { error: String(err), timestamp: new Date().toISOString() },
      { status: 503 }
    );
  }
}
