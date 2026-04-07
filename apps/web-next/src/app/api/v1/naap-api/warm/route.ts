// NAAP API Cache Warmer
// GET /api/v1/naap-api/warm
//
// Populates the in-process mem cache for NAAP API-backed dashboard data
// using the same getters as the dashboard resolvers.
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
  const isDev = process.env.NODE_ENV === 'development';

  if (!cronSecret && !isDev) {
    return NextResponse.json(
      { error: 'CRON_SECRET is not configured' },
      { status: 500 },
    );
  }

  if (cronSecret) {
    const authHeader = request.headers.get('authorization');
    if (authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  try {
    const result = await warmDashboardCaches();
    const results = [
      { target: 'pipelines', ok: true, count: result.pipelines.count },
    ];
    return NextResponse.json({
      warmed: results.length,
      results,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[naap-api/warm]', err);
    return NextResponse.json(
      { error: 'Internal server error', timestamp: new Date().toISOString() },
      { status: 503 }
    );
  }
}
