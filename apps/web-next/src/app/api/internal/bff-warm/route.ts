import { NextRequest, NextResponse } from 'next/server';

import { readBffSwrEnv } from '@/lib/api/bff-swr';

export const runtime = 'nodejs';
export const maxDuration = 120;

function authorized(request: NextRequest): boolean {
  const auth = request.headers.get('authorization');
  const cronOk =
    Boolean(process.env.CRON_SECRET) && auth === `Bearer ${process.env.CRON_SECRET}`;
  const secret = request.nextUrl.searchParams.get('secret');
  const manualOk =
    Boolean(process.env.BFF_WARM_SECRET) && secret === process.env.BFF_WARM_SECRET;
  return cronOk || manualOk;
}

/**
 * Warms slow BFF routes so the first real user typically sees SWR HIT/STALE from Redis/memory.
 * Vercel Cron: set `CRON_SECRET` and schedule `GET /api/internal/bff-warm`.
 * Manual: `GET /api/internal/bff-warm?secret=$BFF_WARM_SECRET`
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!authorized(request)) {
    return NextResponse.json({ error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } }, { status: 401 });
  }

  const base =
    process.env.BFF_WARM_ORIGIN ??
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://127.0.0.1:3000');

  const end = new Date();
  const start = new Date(end.getTime() - 24 * 3600 * 1000);
  const perfQs = `start=${encodeURIComponent(start.toISOString())}&end=${encodeURIComponent(end.toISOString())}`;

  // Cover the most-requested first-load routes so the first real user after a
  // cron tick gets SWR HITs/STALEs rather than cold misses.
  const targets = [
    `${base}/api/v1/dashboard/kpi?timeframe=12`,
    `${base}/api/v1/dashboard/kpi?timeframe=24`,
    `${base}/api/v1/dashboard/pipelines?timeframe=12&limit=200`,
    `${base}/api/v1/dashboard/pipelines?timeframe=24&limit=200`,
    `${base}/api/v1/dashboard/orchestrators?period=24h`,
    `${base}/api/v1/dashboard/pipeline-catalog`,
    `${base}/api/v1/dashboard/pricing`,
    `${base}/api/v1/dashboard/gpu-capacity?timeframe=24`,
    `${base}/api/v1/network/perf-by-model?${perfQs}`,
    `${base}/api/v1/network/capacity`,
  ];

  const results: { url: string; ok: boolean; status: number }[] = [];
  for (const url of targets) {
    try {
      const r = await fetch(url, { cache: 'no-store' });
      results.push({ url, ok: r.ok, status: r.status });
    } catch {
      results.push({ url, ok: false, status: 0 });
    }
  }

  return NextResponse.json({
    ok: results.every((r) => r.ok),
    results,
    swr: readBffSwrEnv(),
  });
}
