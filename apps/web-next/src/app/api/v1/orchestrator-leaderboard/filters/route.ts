/**
 * GET /api/v1/orchestrator-leaderboard/filters
 *
 * Returns available filter options (distinct capability names) by querying
 * ClickHouse for warm capabilities seen in the last hour.
 * Falls back to a known list when ClickHouse is unreachable (e.g. local dev).
 */

export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { authorize } from '@/lib/gateway/authorize';
import { success } from '@/lib/api/response';
import { getAuthToken } from '@/lib/api/response';

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

export async function GET(request: NextRequest): Promise<NextResponse | Response> {
  const auth = await authorize(request);
  if (!auth) {
    return NextResponse.json(
      { success: false, error: { code: 'UNAUTHORIZED', message: 'Missing or invalid authentication' } },
      { status: 401 }
    );
  }

  const authToken = getAuthToken(request) || '';
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
  const url = `${baseUrl}/api/v1/gw/clickhouse-query/query`;

  let capabilities: string[];
  let fromFallback = false;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain',
        'Authorization': `Bearer ${authToken}`,
      },
      body: FILTERS_SQL,
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      throw new Error(`ClickHouse query failed (${res.status})`);
    }

    const json = await res.json();
    const chData = (json.data ?? json) as { data?: Array<{ capability_name: string }> };
    capabilities = (chData.data ?? []).map((row: { capability_name: string }) => row.capability_name);
  } catch {
    capabilities = FALLBACK_CAPABILITIES;
    fromFallback = true;
  }

  const response = success({ capabilities, fromFallback });
  response.headers.set('Cache-Control', 'public, max-age=60');
  return response;
}
