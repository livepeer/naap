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
import { getAuthToken } from '@/lib/api/response';
import { getPlan } from '@/lib/orchestrator-leaderboard/plans';
import { evaluateAndCache } from '@/lib/orchestrator-leaderboard/refresh';
import { tieredShuffleDiscoveryAddresses } from '@/lib/orchestrator-leaderboard/discovery-order';

type RouteContext = { params: Promise<{ id: string }> };

function scopeFromAuth(auth: { teamId: string; callerId: string }) {
  return { teamId: auth.teamId, ownerUserId: auth.callerId };
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

  const { id } = await context.params;
  const plan = await getPlan(id, scopeFromAuth(auth));
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

  const authToken = getAuthToken(request) || '';

  try {
    const results = await evaluateAndCache(
      plan,
      authToken,
      request.url,
      request.headers.get('cookie'),
    );

    const out: { address: string }[] = [];
    const seen = new Set<string>();

    for (const capability of plan.capabilities) {
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
        'Cache-Control': 'private, max-age=10',
        'X-Cache-Age': String(results.meta.cacheAgeMs),
        'X-Refresh-Interval': String(results.meta.refreshIntervalMs),
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to evaluate plan';
    return new NextResponse(message, {
      status: 500,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }
}
