/**
 * GET /api/v1/orchestrator-leaderboard/filters
 *
 * Returns available filter options (distinct capability names) by merging:
 *   1. ClickHouse warm capabilities from the last hour
 *   2. Capabilities from the global dataset (populated by cron from all sources)
 *
 * Falls back to a known list when ClickHouse is unreachable (e.g. local dev).
 */

export const runtime = 'nodejs';
export const maxDuration = 30;

import { NextRequest, NextResponse } from 'next/server';
import { authorize } from '@/lib/gateway/authorize';
import { success } from '@/lib/api/response';
import { getAuthToken } from '@/lib/api/response';
import { resolveClickhouseGatewayQueryUrl } from '@/lib/orchestrator-leaderboard/query';
import { getGlobalDataset } from '@/lib/orchestrator-leaderboard/global-dataset';
import { getKnownCapabilities } from '@/lib/orchestrator-leaderboard/config';

const FILTERS_SQL = `SELECT DISTINCT capability_name
FROM semantic.network_capabilities
WHERE timestamp_ts >= now() - INTERVAL 1 HOUR
  AND warm_bool = 1
ORDER BY capability_name
FORMAT JSON`;

const FALLBACK_CAPABILITIES = [
  'noop',
  'streamdiffusion',
  'streamdiffusion-sdxl',
  'streamdiffusion-sdxl-v2v',
];

function isCronAuth(request: NextRequest): boolean {
  const auth = request.headers.get('authorization');
  return Boolean(process.env.CRON_SECRET) && auth === `Bearer ${process.env.CRON_SECRET}`;
}

export async function GET(request: NextRequest): Promise<NextResponse | Response> {
  const cronAuthed = isCronAuth(request);
  if (!cronAuthed) {
    const auth = await authorize(request);
    if (!auth) {
      return NextResponse.json(
        { success: false, error: { code: 'UNAUTHORIZED', message: 'Missing or invalid authentication' } },
        { status: 401 }
      );
    }
  }

  const authToken = cronAuthed ? '' : (getAuthToken(request) || '');
  const url = resolveClickhouseGatewayQueryUrl(request.url);

  const headers: Record<string, string> = {
    'Content-Type': 'text/plain',
    'Authorization': `Bearer ${authToken}`,
  };

  const incomingCookie = request.headers.get('cookie');
  if (incomingCookie) {
    headers['cookie'] = incomingCookie;
  }

  const bypassSecret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  if (bypassSecret) {
    headers['x-vercel-protection-bypass'] = bypassSecret;
  }

  let chCapabilities: string[];
  let fromFallback = false;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: FILTERS_SQL,
      signal: AbortSignal.timeout(20_000),
    });

    if (!res.ok) {
      throw new Error(`ClickHouse query failed (${res.status})`);
    }

    const json = await res.json();
    const chData = (json.data ?? json) as { data?: Array<{ capability_name: string }> };
    chCapabilities = (chData.data ?? []).map((row: { capability_name: string }) => row.capability_name);
  } catch {
    chCapabilities = FALLBACK_CAPABILITIES;
    fromFallback = true;
  }

  // Merge capabilities from the global dataset (in-memory, same instance)
  // or from the DB-persisted list (survives serverless cold starts)
  const globalDs = getGlobalDataset();
  const capSet = new Set(chCapabilities);
  if (globalDs) {
    for (const cap of Object.keys(globalDs.capabilities)) {
      if (cap !== '__uncategorized') capSet.add(cap);
    }
  } else {
    const persisted = await getKnownCapabilities();
    for (const cap of persisted) capSet.add(cap);
  }

  const capabilities = Array.from(capSet).sort();

  const response = success({
    capabilities,
    fromFallback,
    sources: { clickhouse: chCapabilities.length, merged: capabilities.length },
  });
  response.headers.set('Cache-Control', 'private, max-age=60');
  return response;
}
