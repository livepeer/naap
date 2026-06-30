/**
 * GET /api/v1/orchestrator-leaderboard/python-gateway
 *
 * Default python-gateway discovery when no saved discovery plan is selected.
 * python-gateway appends `caps=<pipeline>/<model>`; NaaP uses the model id as
 * the leaderboard capability and returns a bare `[{ "address": "<orchUri>" }]`.
 */

export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';

import { authorize } from '@/lib/gateway/authorize';
import { getAuthToken } from '@/lib/api/response';
import { fetchLeaderboard } from '@/lib/orchestrator-leaderboard/query';
import { tieredShuffleDiscoveryAddresses } from '@/lib/orchestrator-leaderboard/discovery-order';
import {
  isCapabilityAllowedForProvider,
  normalizeBillingProviderSlug,
} from '@/lib/orchestrator-leaderboard/provider-restrictions';
import {
  DISCOVERY_RESPONSE_CACHE_CONTROL,
  ensurePymthouseManifestFresh,
} from '@/lib/pymthouse-manifest';
import {
  buildStoryboardDefaultDiscovery,
  type CapabilityFetchResult,
} from '@/lib/orchestrator-leaderboard/storyboard-default-discovery';
import {
  isStoryboardDefaultDiscoveryEnabled,
  resolveAllCanaryStaticOrchestrators,
  STORYBOARD_DEFAULT_PLAN_ID,
} from '@/lib/orchestrator-leaderboard/storyboard-default-plan';

const DEFAULT_CAPABILITY = 'noop';
const DEFAULT_TOP_N = 100;
const MAX_TOP_N = 1000;

function capabilityFromCapsValue(raw: string): string {
  const value = raw.trim();
  const slash = value.lastIndexOf('/');
  return slash >= 0 ? value.slice(slash + 1).trim() : value;
}

/** Pairs full cap path (allowlist) with short leaderboard capability name (ClickHouse). */
function resolveCapabilityPairs(url: URL): { raw: string; leaderboardCap: string }[] {
  const caps = url.searchParams
    .getAll('caps')
    .map((s) => s.trim())
    .filter(Boolean);
  if (caps.length > 0) {
    return [...new Set(caps)].map((raw) => ({
      raw,
      leaderboardCap: capabilityFromCapsValue(raw),
    }));
  }

  const explicit =
    url.searchParams.get('capability')?.trim() ||
    url.searchParams.get('model')?.trim() ||
    DEFAULT_CAPABILITY;
  return [{ raw: explicit, leaderboardCap: explicit }];
}

function resolveTopN(url: URL): number {
  const raw = url.searchParams.get('topN');
  if (!raw) {
    return DEFAULT_TOP_N;
  }

  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_TOP_N) {
    return DEFAULT_TOP_N;
  }
  return parsed;
}

async function handleStoryboardDefaultPlan(
  request: NextRequest,
  billingProviderSlug: ReturnType<typeof normalizeBillingProviderSlug>,
  authToken: string,
): Promise<Response> {
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
    if (billingProviderSlug === 'pymthouse') {
      await ensurePymthouseManifestFresh();
    }

    const { addresses, byKind, meta } = await buildStoryboardDefaultDiscovery({
      fetchCapabilityAddresses,
      billingProviderSlug,
      canaryStaticOrchestrators: resolveAllCanaryStaticOrchestrators(),
    });

    console.info(
      '[python-gateway] storyboard-default plan served',
      JSON.stringify({
        billingProviderSlug: billingProviderSlug ?? 'default',
        total: addresses.length,
        scope: byKind.scope.length,
        byocCaps: byKind.byoc.length,
        toolCaps: byKind.tool.length,
        staticFleetInjected: meta.staticFleetInjected,
        fromCache: meta.fromCache,
      }),
    );

    return NextResponse.json(
      addresses.map((address) => ({ address })),
      {
        headers: {
          'Cache-Control': DISCOVERY_RESPONSE_CACHE_CONTROL,
          'X-Cache': meta.fromCache ? 'HIT' : 'MISS',
          'X-Cache-Age': String(meta.cacheAgeMs),
          'X-Discovery-Mode': 'storyboard-default',
        },
      },
    );
  } catch (err) {
    console.error('[python-gateway] storyboard-default plan failed', err);
    return new NextResponse('Internal server error', {
      status: 500,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }
}

export async function GET(request: NextRequest): Promise<Response> {
  const auth = await authorize(request);
  if (!auth) {
    return new NextResponse('Unauthorized', {
      status: 401,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }

  const url = new URL(request.url);
  const billingProvider = normalizeBillingProviderSlug(
    url.searchParams.get('billingProviderSlug') ?? url.searchParams.get('billingProvider'),
  );

  const capabilityPairs = resolveCapabilityPairs(url);
  const topN = resolveTopN(url);
  const authToken = getAuthToken(request) || '';

  // NAAP-9: `?plan=storyboard-default` selects the fixed default-plan bundle
  // (static-fleet merge for scope). Gated OFF by default → falls through to the
  // existing per-cap behavior so the Daydream path stays authoritative.
  const planParam = url.searchParams.get('plan')?.trim();
  if (
    planParam === STORYBOARD_DEFAULT_PLAN_ID &&
    isStoryboardDefaultDiscoveryEnabled()
  ) {
    return handleStoryboardDefaultPlan(request, billingProvider, authToken);
  }

  try {
    if (billingProvider === 'pymthouse') {
      await ensurePymthouseManifestFresh();
    }

    const ordered: string[] = [];
    const seen = new Set<string>();
    let cacheAgeMs = 0;
    let fromCache = true;

    for (const { raw, leaderboardCap } of capabilityPairs) {
      if (!isCapabilityAllowedForProvider(raw, billingProvider)) {
        continue;
      }
      const result = await fetchLeaderboard(
        leaderboardCap,
        authToken,
        request.url,
        request.headers.get('cookie'),
      );
      cacheAgeMs = Math.max(cacheAgeMs, Date.now() - result.cachedAt);
      fromCache = fromCache && result.fromCache;

      for (const row of result.rows) {
        const address = row.orch_uri?.trim();
        if (!address || seen.has(address)) {
          continue;
        }
        seen.add(address);
        ordered.push(address);
        if (ordered.length >= topN) {
          break;
        }
      }

      if (ordered.length >= topN) {
        break;
      }
    }

    const addresses = tieredShuffleDiscoveryAddresses(ordered);
    const out = addresses.map((address) => ({ address }));

    return NextResponse.json(out, {
      headers: {
        'Cache-Control': DISCOVERY_RESPONSE_CACHE_CONTROL,
        'X-Cache': fromCache ? 'HIT' : 'MISS',
        'X-Cache-Age': String(cacheAgeMs),
        'X-Discovery-Mode': 'default',
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to fetch default discovery';
    const invalidCapability =
      message.includes('capability is required') ||
      message.includes('capability must') ||
      message.includes('128 characters');
    const status = invalidCapability ? 400 : 500;
    const responseMessage = invalidCapability ? message : 'Internal server error';

    if (status === 500) {
      console.error('[python-gateway] Failed to fetch default discovery', err);
    }

    return new NextResponse(responseMessage, {
      status,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }
}
