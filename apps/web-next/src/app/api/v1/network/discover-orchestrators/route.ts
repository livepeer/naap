/**
 * GET /api/v1/network/discover-orchestrators
 *
 * Public discovery JSON derived from NAAP BFF `GET /v1/net/orchestrators` (same cached bundle
 * as KPI / orchestrator overview). One row per **on-chain orchestrator address**, grouped with
 * the latest `LastSeen` and `capabilities_prices` per `pipeline/model` capability.
 *
 * Query: repeated `caps` — OR match (row kept if `capabilities` includes any listed value).
 * Rows are ordered by `score` descending, then `last_seen_ms` descending, then `address`.
 *
 * @see https://github.com/livepeer/go-livepeer/blob/master/doc/remote-signer.md (Remote discovery)
 */

import { NextRequest, NextResponse } from 'next/server';
import { jsonWithOverviewCache, OverviewHttpCacheSec } from '@/lib/api/overview-http-cache';
import {
  getOrchestratorDiscoveryList,
  type OrchestratorDiscoveryEntry,
} from '@/lib/facade/resolvers/net-orchestrators';

export const runtime = 'nodejs';
export const maxDuration = 60;
// Literal required for Next segment config; matches OVERVIEW_HTTP_CACHE_SEC (30m).
export const revalidate = 1800;

function filterByCaps(rows: OrchestratorDiscoveryEntry[], caps: string[]): OrchestratorDiscoveryEntry[] {
  if (caps.length === 0) {
    return rows;
  }
  return rows.filter((row) => caps.some((wanted) => row.capabilities.includes(wanted)));
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const baseRows = await getOrchestratorDiscoveryList();
    const caps = Array.from(
      new Set(
        request.nextUrl.searchParams
          .getAll('caps')
          .map((c) => c.trim())
          .filter((c) => c.length > 0),
      ),
    );
    const filtered = filterByCaps(baseRows, caps);
    return jsonWithOverviewCache(filtered, OverviewHttpCacheSec.discoverOrchestrators);
  } catch (err) {
    console.error('[network/discover-orchestrators]', err);
    return NextResponse.json(
      {
        error: {
          code: 'SERVICE_UNAVAILABLE',
          message: 'Orchestrator discovery data is unavailable',
        },
      },
      { status: 503, headers: { 'Cache-Control': 'public, max-age=0, s-maxage=5, stale-while-revalidate=0' } },
    );
  }
}
