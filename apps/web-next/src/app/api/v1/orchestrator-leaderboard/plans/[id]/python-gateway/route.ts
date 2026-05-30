/**
 * GET /api/v1/orchestrator-leaderboard/plans/:id/python-gateway
 *
 * Returns a bare JSON array for python-gateway discovery:
 * `[{ "address": "<orchUri>" }, ...]`
 *
 * Auth: NaaP `gw_…` gateway API key, NaaP session token, or CRON_SECRET (warm cron).
 */

export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';

import { authorize } from '@/lib/gateway/authorize';
import { ensurePymthouseManifestFresh } from '@/lib/pymthouse-manifest';
import { verifyCronAuth } from '@/lib/orchestrator-leaderboard/cron-auth';
import { DISCOVERY_RESPONSE_CACHE_CONTROL } from '@/lib/orchestrator-leaderboard/discovery-constants';
import { getGlobalDatasetStats } from '@/lib/orchestrator-leaderboard/global-dataset';
import { refreshGlobalDatasetOnStartup } from '@/lib/orchestrator-leaderboard/global-refresh';
import { getPlan, getPlanById } from '@/lib/orchestrator-leaderboard/plans';
import {
  countPlanOrchestrators,
  evaluateAndCache,
  invalidatePlanCache,
} from '@/lib/orchestrator-leaderboard/refresh';
import { tieredShuffleDiscoveryAddresses } from '@/lib/orchestrator-leaderboard/discovery-order';
import {
  normalizeBillingProviderSlug,
  resolvePlanCapabilitiesForProvider,
} from '@/lib/orchestrator-leaderboard/provider-restrictions';
import {
  type BillingProviderSlug,
  BillingProviderSlugSchema,
  type DiscoveryPlan,
  type PlanResults,
} from '@/lib/orchestrator-leaderboard/types';

type RouteContext = { params: Promise<{ id: string }> };

function scopeFromAuth(auth: { teamId: string; callerId: string }) {
  return { teamId: auth.teamId, ownerUserId: auth.callerId };
}

function parseBillingProviderSlugParam(
  request: NextRequest,
): { value: BillingProviderSlug | null; error: string | null } {
  const raw = request.nextUrl.searchParams.get('billingProviderSlug');
  if (raw === null) {
    return { value: null, error: null };
  }
  const parsed = BillingProviderSlugSchema.safeParse(raw.trim().toLowerCase());
  if (!parsed.success) {
    return { value: null, error: 'Invalid billingProviderSlug' };
  }
  return { value: parsed.data, error: null };
}

function buildAddressList(
  allowedCaps: string[],
  results: PlanResults,
): { address: string }[] {
  const out: { address: string }[] = [];
  const seen = new Set<string>();

  for (const capability of allowedCaps) {
    const rows = results.capabilities[capability] ?? [];
    for (const row of rows) {
      const u = row.orchUri?.trim();
      if (!u || seen.has(u)) {
        continue;
      }
      seen.add(u);
      out.push({ address: u });
    }
  }

  const addresses = tieredShuffleDiscoveryAddresses(out.map((o) => o.address));
  return addresses.map((address) => ({ address }));
}

async function evaluatePlanDiscovery(planForEval: DiscoveryPlan): Promise<PlanResults> {
  let results = await evaluateAndCache(planForEval);

  if (countPlanOrchestrators(results) > 0) {
    return results;
  }

  const stats = await getGlobalDatasetStats();
  if (stats.populated) {
    return results;
  }

  await refreshGlobalDatasetOnStartup();
  results = await evaluateAndCache(planForEval);
  return results;
}

export async function GET(
  request: NextRequest,
  context: RouteContext,
): Promise<Response> {
  const cronAuthed = verifyCronAuth(request);
  const auth = cronAuthed ? null : await authorize(request);
  if (!cronAuthed && !auth) {
    return new NextResponse('Unauthorized', {
      status: 401,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }

  const parsedSlug = parseBillingProviderSlugParam(request);
  if (parsedSlug.error) {
    return new NextResponse(parsedSlug.error, {
      status: 400,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }

  const { id } = await context.params;
  const plan = cronAuthed
    ? await getPlanById(id)
    : await getPlan(id, scopeFromAuth(auth), parsedSlug.value);
  if (!plan) {
    return new NextResponse('Not found', {
      status: 404,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }

  if (!plan.enabled) {
    return new NextResponse('Plan is disabled', {
      status: 400,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }

  if (normalizeBillingProviderSlug(plan.billingProviderSlug) === 'pymthouse') {
    await ensurePymthouseManifestFresh({
      onRevisionChanged: () => invalidatePlanCache(plan.id),
    });
  }

  const allowedCaps = resolvePlanCapabilitiesForProvider(plan);
  if (allowedCaps.length === 0) {
    return NextResponse.json([], {
      headers: {
        'Cache-Control': DISCOVERY_RESPONSE_CACHE_CONTROL,
        'X-Pymthouse-Manifest': 'empty',
      },
    });
  }

  const planForEval = { ...plan, capabilities: allowedCaps };

  try {
    const results = await evaluatePlanDiscovery(planForEval);
    const randomized = buildAddressList(allowedCaps, results);

    return NextResponse.json(randomized, {
      headers: {
        'Cache-Control': DISCOVERY_RESPONSE_CACHE_CONTROL,
        'X-Cache-Age': String(results.meta.cacheAgeMs),
        'X-Refresh-Interval': String(results.meta.refreshIntervalMs),
      },
    });
  } catch (err) {
    console.error('[plans/python-gateway] evaluateAndCache failed:', err);
    return new NextResponse('Internal server error', {
      status: 500,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }
}
