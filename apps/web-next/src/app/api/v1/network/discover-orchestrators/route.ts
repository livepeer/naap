/**
 * GET /api/v1/network/discover-orchestrators
 *
 * Public, remote-signer-compatible orchestrator discovery (JSON array).
 * Query: repeated `caps` — OR match (orchestrator included if it advertises any listed capability).
 *
 * @see https://github.com/livepeer/go-livepeer/blob/master/doc/remote-signer.md (Remote discovery)
 */

import { NextRequest, NextResponse } from 'next/server';
import discoverOrchestrators from '@/data/discover-orchestrators.json';
import { jsonWithOverviewCache, OverviewHttpCacheSec } from '@/lib/api/overview-http-cache';

export const runtime = 'nodejs';
export const maxDuration = 30;
// Literal required for Next segment config; matches OVERVIEW_HTTP_CACHE_SEC (30m).
export const revalidate = 1800;

type DiscoverOrchestratorRow = {
  address: string;
  score: number;
  capabilities: string[];
};

function isDiscoverRow(x: unknown): x is DiscoverOrchestratorRow {
  if (x == null || typeof x !== 'object') {
    return false;
  }
  const o = x as Record<string, unknown>;
  return (
    typeof o.address === 'string'
    && o.address.trim().length > 0
    && typeof o.score === 'number'
    && Number.isFinite(o.score)
    && Array.isArray(o.capabilities)
    && o.capabilities.every((c) => typeof c === 'string')
  );
}

function normalizeRows(raw: unknown): DiscoverOrchestratorRow[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const out: DiscoverOrchestratorRow[] = [];
  for (const item of raw) {
    if (isDiscoverRow(item)) {
      out.push({
        address: item.address.trim(),
        score: item.score,
        capabilities: item.capabilities.map((c) => c.trim()).filter(Boolean),
      });
    }
  }
  return out;
}

/** OR semantics: keep rows that advertise at least one requested capability. */
function filterByCaps(rows: DiscoverOrchestratorRow[], caps: string[]): DiscoverOrchestratorRow[] {
  if (caps.length === 0) {
    return rows;
  }
  return rows.filter((row) => caps.some((wanted) => row.capabilities.includes(wanted)));
}

const BASE_ROWS = normalizeRows(discoverOrchestrators);

export async function GET(request: NextRequest): Promise<NextResponse> {
  if (BASE_ROWS.length === 0) {
    console.error('[network/discover-orchestrators] empty or invalid curated list');
    return NextResponse.json(
      { error: { code: 'SERVICE_UNAVAILABLE', message: 'Orchestrator discovery data is unavailable' } },
      { status: 503 },
    );
  }

  const caps = Array.from(
    new Set(
      request.nextUrl.searchParams
        .getAll('caps')
        .map((c) => c.trim())
        .filter((c) => c.length > 0),
    ),
  );

  const filtered = filterByCaps(BASE_ROWS, caps);
  return jsonWithOverviewCache(filtered, OverviewHttpCacheSec.discoverOrchestrators);
}
