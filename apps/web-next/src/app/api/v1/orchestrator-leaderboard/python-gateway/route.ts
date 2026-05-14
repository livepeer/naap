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

const DEFAULT_CAPABILITY = 'noop';
const DEFAULT_TOP_N = 100;
const MAX_TOP_N = 1000;

function capabilityFromCapsValue(raw: string): string {
  const value = raw.trim();
  const slash = value.lastIndexOf('/');
  return slash >= 0 ? value.slice(slash + 1).trim() : value;
}

function resolveCapabilities(url: URL): string[] {
  const caps = url.searchParams
    .getAll('caps')
    .map(capabilityFromCapsValue)
    .filter(Boolean);

  if (caps.length > 0) {
    return [...new Set(caps)];
  }

  const explicit =
    url.searchParams.get('capability')?.trim() ||
    url.searchParams.get('model')?.trim() ||
    DEFAULT_CAPABILITY;
  return [explicit];
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

export async function GET(request: NextRequest): Promise<Response> {
  const auth = await authorize(request);
  if (!auth) {
    return new NextResponse('Unauthorized', {
      status: 401,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }

  const url = new URL(request.url);
  const capabilities = resolveCapabilities(url);
  const topN = resolveTopN(url);
  const authToken = getAuthToken(request) || '';

  try {
    const ordered: string[] = [];
    const seen = new Set<string>();
    let cacheAgeMs = 0;
    let fromCache = true;

    for (const capability of capabilities) {
      const result = await fetchLeaderboard(
        capability,
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
        'Cache-Control': 'private, max-age=10',
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

    return new NextResponse(message, {
      status: invalidCapability ? 400 : 500,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }
}
