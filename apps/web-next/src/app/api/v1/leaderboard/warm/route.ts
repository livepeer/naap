// Leaderboard Cache Warmer
// GET /api/v1/leaderboard/warm
//
// Pre-fetches dashboard leaderboard endpoints so the Next.js fetch cache is
// populated before users arrive. Paginated endpoints fetch **every page**
// (same logic as raw-data.ts `fetchAllPages`). Does not warm gpu/metrics
// (GPU inventory uses ClickHouse, not leaderboard).
//
// Auth: CRON_SECRET (same pattern as /api/v1/gw/admin/health/check).

export const runtime = 'nodejs';
export const maxDuration = 120;

import { NextRequest, NextResponse } from 'next/server';
import {
  DASHBOARD_LEADERBOARD_WINDOW,
  LEADERBOARD_CACHE_TTLS,
  warmLeaderboardPaginated,
  warmLeaderboardPipelines,
} from '@/lib/dashboard/raw-data';

// BFF fetches a single max window per series; UI slices in memory.
const WARM_WINDOW = DASHBOARD_LEADERBOARD_WINDOW;

type WarmWork = {
  target: string;
  run: () => Promise<Record<string, unknown>>;
};

function buildWarmWork(): WarmWork[] {
  const ttl = LEADERBOARD_CACHE_TTLS;
  const window = WARM_WINDOW;
  const work: WarmWork[] = [
    {
      target: 'pipelines',
      run: async () => {
        const r = await warmLeaderboardPipelines(ttl.pipelines);
        return {
          ok: r.ok,
          status: r.status,
          pages: 1,
          pipelines: r.count,
        };
      },
    },
    {
      target: `network/demand?window=${window}`,
      run: async () => {
        const { pages, rows } = await warmLeaderboardPaginated(
          'network/demand',
          'demand',
          window,
          ttl.demand
        );
        return { ok: true, status: 200, pages, rows };
      },
    },
    {
      target: `sla/compliance?window=${window}`,
      run: async () => {
        const { pages, rows } = await warmLeaderboardPaginated(
          'sla/compliance',
          'compliance',
          window,
          ttl.sla
        );
        return { ok: true, status: 200, pages, rows };
      },
    },
  ];

  return work;
}

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get('authorization');
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const work = buildWarmWork();
  const settled = await Promise.allSettled(work.map((w) => w.run()));

  const results = settled.map((r, i) => {
    const target = work[i].target;
    if (r.status === 'rejected') {
      return { target, ok: false, error: String(r.reason) };
    }
    const v = r.value;
    const ok = v.ok === true;
    return { target, ok, ...v };
  });

  const allOk = results.every((s) => s.ok);
  return NextResponse.json(
    { warmed: results.length, results, timestamp: new Date().toISOString() },
    { status: allOk ? 200 : 207 }
  );
}
