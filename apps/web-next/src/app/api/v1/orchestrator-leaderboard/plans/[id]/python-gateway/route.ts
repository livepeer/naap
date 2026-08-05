/**
 * GET /api/v1/orchestrator-leaderboard/plans/:id/python-gateway
 *
 * Returns a bare JSON array for python-gateway discovery:
 * `[{ "address": "<orchUri>" }, ...]`
 *
 * Auth: same as plan results (NaaP `gw_…` gateway API key or NaaP session token).
 *
 * Signer-bundle public plans (`naap-default-daydream-byoc`,
 * `naap-default-pymthouse-live-runner`) reuse the signer-bundle shortlist
 * builder (static-fleet aware) so they match `/bundles/{slug}/python-gateway`.
 */

export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';

import { authorize } from '@/lib/gateway/authorize';
import { getAuthToken } from '@/lib/api/response';
import { DISCOVERY_RESPONSE_CACHE_CONTROL } from '@/lib/orchestrator-leaderboard/discovery-constants';
import { getPlan } from '@/lib/orchestrator-leaderboard/plans';
import { evaluateAndCache } from '@/lib/orchestrator-leaderboard/refresh';
import { tieredShuffleDiscoveryAddresses } from '@/lib/orchestrator-leaderboard/discovery-order';
import { resolvePlanCapabilitiesForProvider } from '@/lib/orchestrator-leaderboard/provider-restrictions';
import { fetchLeaderboard } from '@/lib/orchestrator-leaderboard/query';
import { getSignerBundle } from '@/lib/orchestrator-leaderboard/signer-bundle-config';
import {
  buildSignerBundleDiscovery,
  type CapabilityFetchResult,
} from '@/lib/orchestrator-leaderboard/signer-bundle-discovery';
import { signerBundleSlugForPlanBillingId } from '@/lib/orchestrator-leaderboard/signer-bundle-plan-ids';
import {
  type BillingProviderSlug,
  BillingProviderSlugSchema,
  type DiscoveryPlan,
} from '@/lib/orchestrator-leaderboard/types';
import { ensurePymthouseManifestFresh } from '@/lib/pymthouse-manifest';

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

export async function GET(
  request: NextRequest,
  context: RouteContext,
): Promise<Response> {
  const auth = await authorize(request);
  if (!auth) {
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
  const plan = await getPlan(id, scopeFromAuth(auth), parsedSlug.value);
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

  const bundleSlug = signerBundleSlugForPlanBillingId(plan.billingPlanId);
  if (bundleSlug) {
    return serveSignerBundlePlan(request, plan, bundleSlug);
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
    const results = await evaluateAndCache(planForEval);

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
    const randomized = addresses.map((address) => ({ address }));

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

async function serveSignerBundlePlan(
  request: NextRequest,
  plan: DiscoveryPlan,
  bundleSlug: NonNullable<ReturnType<typeof signerBundleSlugForPlanBillingId>>,
): Promise<Response> {
  const bundle = await getSignerBundle(bundleSlug);
  if (!bundle || !bundle.enabled) {
    return new NextResponse('Not found', {
      status: 404,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }

  if (bundle.billingProviderSlug === 'pymthouse') {
    try {
      await ensurePymthouseManifestFresh();
    } catch (err) {
      console.warn('[plans/python-gateway] pymthouse manifest refresh failed', err);
    }
  }

  const authToken = getAuthToken(request) || '';
  const cookieHeader = request.headers.get('cookie');
  const fetchCapabilityAddresses = async (
    leaderboardCap: string,
  ): Promise<CapabilityFetchResult> => {
    const result = await fetchLeaderboard(leaderboardCap, authToken, request.url, cookieHeader);
    const addresses: string[] = [];
    for (const row of result.rows) {
      const address = row.orch_uri?.trim();
      if (address) addresses.push(address);
    }
    return { addresses, fromCache: result.fromCache, cachedAt: result.cachedAt };
  };

  try {
    const { addresses, meta } = await buildSignerBundleDiscovery({
      bundle,
      fetchCapabilityAddresses,
      topN: plan.topN ?? bundle.topN,
    });

    return NextResponse.json(
      addresses.map((address) => ({ address })),
      {
        headers: {
          'Cache-Control': DISCOVERY_RESPONSE_CACHE_CONTROL,
          'X-Cache': meta.fromCache ? 'HIT' : 'MISS',
          'X-Cache-Age': String(meta.cacheAgeMs),
          'X-Discovery-Bundle': bundleSlug,
          'X-Discovery-Mode': 'signer-bundle-plan',
        },
      },
    );
  } catch (err) {
    console.error('[plans/python-gateway] signer-bundle plan failed', {
      billingPlanId: plan.billingPlanId,
      bundleSlug,
      err,
    });
    return new NextResponse('Internal server error', {
      status: 500,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }
}
