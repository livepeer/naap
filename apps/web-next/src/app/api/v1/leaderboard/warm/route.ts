// Leaderboard Cache Warmer
// GET /api/v1/leaderboard/warm
//
// Pre-fetches all dashboard endpoint/window combinations so the Next.js
// fetch cache is populated before users arrive. Each fetch uses the same
// `next: { revalidate }` TTLs as the proxy route, so they share cache keys.
//
// Triggered by Vercel Cron every 3 minutes (matches the shortest TTL).
// Auth: CRON_SECRET (same pattern as /api/v1/gw/admin/health/check).

export const runtime = 'nodejs';
export const maxDuration = 60;

import { NextRequest, NextResponse } from 'next/server';

const LEADERBOARD_API_URL = process.env.LEADERBOARD_API_URL || 'https://leaderboard-api.livepeer.cloud';

const ENDPOINT_TTL_SECONDS: Record<string, number> = {
  'pipelines': 15 * 60,
  'gpu/metrics': 5 * 60,
  'sla/compliance': 5 * 60,
  'network/demand': 3 * 60,
};

// All dashboard timeframes: 1d, 7d, 14d, 30d
const TIMEFRAMES = ['24h', '168h', '336h', '720h'];
// GPU metrics API is capped at 72h; 168h/336h/720h all resolve to 72h
const GPU_TIMEFRAMES = ['24h', '72h'];

type WarmTarget = { endpoint: string; params: URLSearchParams };

function buildTargets(): WarmTarget[] {
  const targets: WarmTarget[] = [];

  targets.push({ endpoint: 'pipelines', params: new URLSearchParams() });

  for (const window of TIMEFRAMES) {
    targets.push({
      endpoint: 'network/demand',
      params: new URLSearchParams({ window, page: '1', page_size: '500' }),
    });
    targets.push({
      endpoint: 'sla/compliance',
      params: new URLSearchParams({ window, page: '1', page_size: '500' }),
    });
  }

  for (const window of GPU_TIMEFRAMES) {
    targets.push({
      endpoint: 'gpu/metrics',
      params: new URLSearchParams({ window, page: '1', page_size: '500' }),
    });
  }

  return targets;
}

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get('authorization');
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const targets = buildTargets();

  const results = await Promise.allSettled(
    targets.map(async ({ endpoint, params }) => {
      const qs = params.toString();
      const url = `${LEADERBOARD_API_URL}/api/${endpoint}${qs ? `?${qs}` : ''}`;
      const ttl = ENDPOINT_TTL_SECONDS[endpoint] ?? 5 * 60;
      const res = await fetch(url, {
        headers: { Accept: 'application/json' },
        next: { revalidate: ttl },
        signal: AbortSignal.timeout(30_000),
      });
      return { endpoint, qs, status: res.status, ok: res.ok };
    })
  );

  const summary = results.map((r, i) => {
    const { endpoint, params } = targets[i];
    const qs = params.toString();
    const target = qs ? `${endpoint}?${qs}` : endpoint;
    if (r.status === 'fulfilled') {
      return { target, ok: r.value.ok, status: r.value.status };
    }
    return { target, ok: false, error: String(r.reason) };
  });

  const allOk = summary.every(s => s.ok);
  return NextResponse.json(
    { warmed: summary.length, results: summary, timestamp: new Date().toISOString() },
    { status: allOk ? 200 : 207 }
  );
}
