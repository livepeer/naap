/**
 * GET /api/v1/orchestrator-leaderboard/plans/:id/python-gateway
 *
 * Returns a bare JSON array for python-gateway discovery:
 * `[{ "address": "<orchUri>" }, ...]`
 *
 * Auth: same as plan results (NaaP `gw_…` gateway API key or NaaP session token).
 */

export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';

import { authorize } from '@/lib/gateway/authorize';
import { DISCOVERY_RESPONSE_CACHE_CONTROL } from '@/lib/orchestrator-leaderboard/discovery-constants';
import { getPlan } from '@/lib/orchestrator-leaderboard/plans';
import { evaluateAndCache } from '@/lib/orchestrator-leaderboard/refresh';
import { tieredShuffleDiscoveryAddresses } from '@/lib/orchestrator-leaderboard/discovery-order';
import { resolvePlanCapabilitiesForProvider } from '@/lib/orchestrator-leaderboard/provider-restrictions';
import {
  type BillingProviderSlug,
  BillingProviderSlugSchema,
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
