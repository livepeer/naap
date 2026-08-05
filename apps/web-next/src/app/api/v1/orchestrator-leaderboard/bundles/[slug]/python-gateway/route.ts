/**
 * GET /api/v1/orchestrator-leaderboard/bundles/:slug/python-gateway
 *
 * Signer-bundle discovery — returns bare `[{ "address": "<orchUri>" }, ...]`
 * for a configured signer plane:
 *   - daydream-byoc          → Daydream signer + BYOC/tool orchs
 *   - pymthouse-live-runner  → pymthouse signer + Live Runner orchs
 *
 * Gated by SIGNER_BUNDLE_DISCOVERY_ENABLED (default OFF). Bundle contents are
 * admin-configurable via /bundles/config; code defaults come from
 * STORYBOARD_DEFAULT_PLAN categories.
 */

export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';

import { authorize } from '@/lib/gateway/authorize';
import { getAuthToken } from '@/lib/api/response';
import { fetchLeaderboard } from '@/lib/orchestrator-leaderboard/query';
import { DISCOVERY_RESPONSE_CACHE_CONTROL } from '@/lib/orchestrator-leaderboard/discovery-constants';
import { getSignerBundle } from '@/lib/orchestrator-leaderboard/signer-bundle-config';
import {
  buildSignerBundleDiscovery,
  type CapabilityFetchResult,
} from '@/lib/orchestrator-leaderboard/signer-bundle-discovery';
import {
  isSignerBundleDiscoveryEnabled,
  isSignerBundleSlug,
  type SignerBundleSlug,
} from '@/lib/orchestrator-leaderboard/signer-bundle-types';
import { ensurePymthouseManifestFresh } from '@/lib/pymthouse-manifest';

type RouteContext = { params: Promise<{ slug: string }> };

const DEFAULT_TOP_N = 100;
const MAX_TOP_N = 1000;

function resolveTopN(url: URL, bundleDefault: number): number {
  const raw = url.searchParams.get('topN');
  if (!raw) return bundleDefault || DEFAULT_TOP_N;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_TOP_N) {
    return bundleDefault || DEFAULT_TOP_N;
  }
  return parsed;
}

function resolveCapsFilter(url: URL): string[] | undefined {
  const caps = url.searchParams
    .getAll('caps')
    .map((s) => s.trim())
    .filter(Boolean);
  if (caps.length > 0) return [...new Set(caps)];

  const single =
    url.searchParams.get('capability')?.trim() ||
    url.searchParams.get('model')?.trim();
  return single ? [single] : undefined;
}

export async function GET(
  request: NextRequest,
  context: RouteContext,
): Promise<Response> {
  if (!isSignerBundleDiscoveryEnabled()) {
    return new NextResponse('Not found', {
      status: 404,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }

  const { slug: rawSlug } = await context.params;
  if (!isSignerBundleSlug(rawSlug)) {
    return new NextResponse('Not found', {
      status: 404,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }
  const slug: SignerBundleSlug = rawSlug;

  const auth = await authorize(request);
  if (!auth) {
    return new NextResponse('Unauthorized', {
      status: 401,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }

  const bundle = await getSignerBundle(slug);
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
      console.warn('[signer-bundle-discovery] pymthouse manifest refresh failed', err);
    }
  }

  const url = new URL(request.url);
  const topN = resolveTopN(url, bundle.topN);
  const filterCapabilities = resolveCapsFilter(url);
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
      filterCapabilities,
      topN,
    });

    const out = addresses.map((address) => ({ address }));

    console.info(
      '[signer-bundle-discovery] served',
      JSON.stringify({
        slug,
        billingProviderSlug: bundle.billingProviderSlug,
        total: out.length,
        categories: meta.categoriesQueried,
        capabilitiesQueried: meta.capabilitiesQueried,
        staticFleetInjected: meta.staticFleetInjected,
        fromCache: meta.fromCache,
      }),
    );

    return NextResponse.json(out, {
      headers: {
        'Cache-Control': DISCOVERY_RESPONSE_CACHE_CONTROL,
        'X-Cache': meta.fromCache ? 'HIT' : 'MISS',
        'X-Cache-Age': String(meta.cacheAgeMs),
        'X-Discovery-Bundle': slug,
        'X-Discovery-Mode': 'signer-bundle',
      },
    });
  } catch (err) {
    console.error('[signer-bundle-discovery] failed', { slug, err });
    return new NextResponse('Internal server error', {
      status: 500,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }
}
