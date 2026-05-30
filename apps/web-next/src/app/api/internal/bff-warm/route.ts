import { NextRequest, NextResponse } from 'next/server';

import { readBffSwrEnv } from '@/lib/api/bff-swr';
import { refreshGlobalDatasetOnStartup } from '@/lib/orchestrator-leaderboard/global-refresh';
import { listEnabledPlans } from '@/lib/orchestrator-leaderboard/plans';

export const runtime = 'nodejs';
export const maxDuration = 120;

const PLAN_WARM_CONCURRENCY = 4;
const DEFAULT_PLAN_WARM_MAX = 32;

function authorized(request: NextRequest): boolean {
  const auth = request.headers.get('authorization');
  const cronOk =
    Boolean(process.env.CRON_SECRET) && auth === `Bearer ${process.env.CRON_SECRET}`;
  const secret = request.nextUrl.searchParams.get('secret');
  const manualOk =
    Boolean(process.env.BFF_WARM_SECRET) && secret === process.env.BFF_WARM_SECRET;
  return cronOk || manualOk;
}

function planWarmMax(): number {
  const raw = process.env.LEADERBOARD_WARM_PLAN_MAX?.trim();
  if (!raw) return DEFAULT_PLAN_WARM_MAX;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) return DEFAULT_PLAN_WARM_MAX;
  return n;
}

async function warmPlanDiscoveryUrls(
  base: string,
  cronSecret: string,
  plans: Awaited<ReturnType<typeof listEnabledPlans>>,
): Promise<{ planId: string; ok: boolean; status: number }[]> {
  const results: { planId: string; ok: boolean; status: number }[] = [];
  const capped = plans.slice(0, planWarmMax());

  for (let i = 0; i < capped.length; i += PLAN_WARM_CONCURRENCY) {
    const batch = capped.slice(i, i + PLAN_WARM_CONCURRENCY);
    const batchResults = await Promise.all(
      batch.map(async (plan) => {
        const slug = plan.billingProviderSlug ?? 'pymthouse';
        const url =
          `${base}/api/v1/orchestrator-leaderboard/plans/${encodeURIComponent(plan.id)}` +
          `/python-gateway?billingProviderSlug=${encodeURIComponent(slug)}`;
        try {
          const r = await fetch(url, {
            cache: 'no-store',
            headers: { Authorization: `Bearer ${cronSecret}` },
          });
          return { planId: plan.id, ok: r.ok, status: r.status };
        } catch {
          return { planId: plan.id, ok: false, status: 0 };
        }
      }),
    );
    results.push(...batchResults);
  }

  return results;
}

/**
 * Warms slow BFF routes so the first real user typically sees SWR HIT/STALE from Redis/memory.
 * Upstream contract: repo-root `openapi.yaml` (NAAP Analytics API v1).
 * Vercel Cron: set `CRON_SECRET` and schedule `GET /api/internal/bff-warm`.
 * Manual: `GET /api/internal/bff-warm?secret=$BFF_WARM_SECRET`
 */
async function fetchWarmTargets(
  urls: string[],
  headers?: Record<string, string>,
): Promise<{ url: string; ok: boolean; status: number }[]> {
  const out: { url: string; ok: boolean; status: number }[] = [];
  for (const url of urls) {
    try {
      const r = await fetch(url, { cache: 'no-store', headers });
      out.push({ url, ok: r.ok, status: r.status });
    } catch {
      out.push({ url, ok: false, status: 0 });
    }
  }
  return out;
}

async function warmLeaderboardForCron(
  base: string,
  cronSecret: string,
): Promise<{
  planDiscoveryWarm: { planId: string; ok: boolean; status: number }[];
  authedResults: { url: string; ok: boolean; status: number }[];
}> {
  const authedResults = await fetchWarmTargets(
    [`${base}/api/v1/orchestrator-leaderboard/filters`],
    { Authorization: `Bearer ${cronSecret}` },
  );

  try {
    await refreshGlobalDatasetOnStartup();
  } catch (err) {
    console.warn('[bff-warm] refreshGlobalDatasetOnStartup failed:', err);
  }

  let planDiscoveryWarm: { planId: string; ok: boolean; status: number }[] = [];
  try {
    const plans = await listEnabledPlans();
    planDiscoveryWarm = await warmPlanDiscoveryUrls(base, cronSecret, plans);
  } catch (err) {
    console.warn('[bff-warm] plan discovery warm failed:', err);
  }

  return { planDiscoveryWarm, authedResults };
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!authorized(request)) {
    return NextResponse.json({ error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } }, { status: 401 });
  }

  const { appUrl: _appUrl } = await import('@/lib/env');
  const base =
    process.env.BFF_WARM_ORIGIN ??
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : _appUrl);

  const end = new Date();
  const start = new Date(end.getTime() - 24 * 3600 * 1000);
  const perfQs = `start=${encodeURIComponent(start.toISOString())}&end=${encodeURIComponent(end.toISOString())}`;

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

  const cronSecret = process.env.CRON_SECRET;
  const results = await fetchWarmTargets(targets);

  if (!cronSecret) {
    return NextResponse.json({
      ok: results.every((r) => r.ok),
      results,
      swr: readBffSwrEnv(),
    });
  }

  const { planDiscoveryWarm, authedResults } = await warmLeaderboardForCron(base, cronSecret);
  const allResults = [...results, ...authedResults];
  const planWarmOk = planDiscoveryWarm.every((r) => r.ok);

  return NextResponse.json({
    ok: allResults.every((r) => r.ok) && planWarmOk,
    results: allResults,
    planDiscoveryWarm,
    swr: readBffSwrEnv(),
  });
}
