/**
 * GET /api/v1/orchestrator-leaderboard/storyboard-default/python-gateway
 *
 * NAAP-9 — the Storyboard Default discovery bundle (Daydream parity). Returns
 * the fixed default-plan orchestrator/capability set (scope staging + BYOC +
 * tool) with a static-fleet fallback merged into the tier shuffle, so the
 * Daydream→NaaP discovery switch is non-disruptive.
 *
 * Gated by `STORYBOARD_DEFAULT_DISCOVERY_ENABLED` (default OFF): when OFF the
 * endpoint is disabled (404) and the Daydream path stays authoritative.
 */

export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';

import { authorize } from '@/lib/gateway/authorize';
import { getAuthToken } from '@/lib/api/response';
import { fetchLeaderboard } from '@/lib/orchestrator-leaderboard/query';
import { normalizeBillingProviderSlug } from '@/lib/orchestrator-leaderboard/provider-restrictions';
import { DISCOVERY_RESPONSE_CACHE_CONTROL } from '@/lib/orchestrator-leaderboard/discovery-constants';
import {
  buildStoryboardDefaultDiscovery,
  type CapabilityFetchResult,
} from '@/lib/orchestrator-leaderboard/storyboard-default-discovery';
import { isStoryboardDefaultDiscoveryEnabled } from '@/lib/orchestrator-leaderboard/storyboard-default-plan';
import {
  isByocToolDiscoveryEnabled,
  resolveByocToolCapabilities,
} from '@/lib/orchestrator-leaderboard/byoc-tool-discovery';

export async function GET(request: NextRequest): Promise<Response> {
  if (!isStoryboardDefaultDiscoveryEnabled()) {
    return new NextResponse('Not found', {
      status: 404,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }

  const auth = await authorize(request);
  if (!auth) {
    return new NextResponse('Unauthorized', {
      status: 401,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }

  const url = new URL(request.url);
  const billingProviderSlug = normalizeBillingProviderSlug(
    url.searchParams.get('billingProviderSlug') ?? url.searchParams.get('billingProvider'),
  );
  const authToken = getAuthToken(request) || '';
  const cookieHeader = request.headers.get('cookie');

  const fetchCapabilityAddresses = async (
    leaderboardCap: string,
  ): Promise<CapabilityFetchResult> => {
    const result = await fetchLeaderboard(leaderboardCap, authToken, request.url, cookieHeader);
    const addresses: string[] = [];
    for (const row of result.rows) {
      const address = row.orch_uri?.trim();
      if (address) {
        addresses.push(address);
      }
    }
    return { addresses, fromCache: result.fromCache, cachedAt: result.cachedAt };
  };

  try {
    // NAAP-3: when discovery is ON, drive byoc/tool capability lists from the
    // live fleet instead of the hardcoded plan constants. OFF (default) →
    // undefined → the committed baseline is used (golden-set parity preserved).
    const categoryCapabilities = isByocToolDiscoveryEnabled()
      ? await resolveByocToolCapabilities()
      : undefined;

    const { addresses, byKind, meta } = await buildStoryboardDefaultDiscovery({
      fetchCapabilityAddresses,
      billingProviderSlug,
      categoryCapabilities,
    });

    const out = addresses.map((address) => ({ address }));

    // Structured logging — counts only, no addresses/keys/PII.
    console.info(
      '[storyboard-default-discovery] served',
      JSON.stringify({
        billingProviderSlug: billingProviderSlug ?? 'default',
        total: out.length,
        scope: byKind.scope.length,
        byocCaps: byKind.byoc.length,
        toolCaps: byKind.tool.length,
        staticFleetInjected: meta.staticFleetInjected,
        fromCache: meta.fromCache,
      }),
    );

    return NextResponse.json(out, {
      headers: {
        'Cache-Control': DISCOVERY_RESPONSE_CACHE_CONTROL,
        'X-Cache': meta.fromCache ? 'HIT' : 'MISS',
        'X-Cache-Age': String(meta.cacheAgeMs),
        'X-Discovery-Mode': 'storyboard-default',
      },
    });
  } catch (err) {
    console.error('[storyboard-default-discovery] failed to build bundle', err);
    return new NextResponse('Internal server error', {
      status: 500,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }
}
