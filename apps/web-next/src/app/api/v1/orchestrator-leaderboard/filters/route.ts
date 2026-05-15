/**
 * GET /api/v1/orchestrator-leaderboard/filters
 *
 * Returns available filter options (distinct capability names) from the
 * persistent LeaderboardDatasetRow table. Also merges warm capabilities
 * from ClickHouse (last hour) for real-time coverage.
 */

export const runtime = 'nodejs';
export const maxDuration = 30;

import { NextRequest, NextResponse } from 'next/server';
import { authorize } from '@/lib/gateway/authorize';
import { success } from '@/lib/api/response';
import { getAuthToken } from '@/lib/api/response';
import { resolveClickhouseGatewayQueryUrl } from '@/lib/orchestrator-leaderboard/query';
import { getDatasetCapabilities } from '@/lib/orchestrator-leaderboard/global-dataset';

const FILTERS_SQL = `SELECT DISTINCT capability_name
FROM semantic.network_capabilities
WHERE timestamp_ts >= now() - INTERVAL 1 HOUR
  AND warm_bool = 1
ORDER BY capability_name
FORMAT JSON`;

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

  // Fetch warm capabilities from ClickHouse (best-effort)
  let chCapabilities: string[] = [];
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: FILTERS_SQL,
      signal: AbortSignal.timeout(20_000),
    });

    if (res.ok) {
      const json = await res.json();
      const chData = (json.data ?? json) as { data?: Array<{ capability_name: string }> };
      chCapabilities = (chData.data ?? []).map((row: { capability_name: string }) => row.capability_name);
    }
  } catch {
    // ClickHouse unavailable — proceed with DB capabilities only
  }

  // Read persisted capabilities from the LeaderboardDatasetRow table
  const dbCapabilities = await getDatasetCapabilities();

  // Merge both sources (DB is authoritative, ClickHouse adds real-time warm data)
  const capSet = new Set([...dbCapabilities, ...chCapabilities]);
  const capabilities = Array.from(capSet).sort();

  const response = success({
    capabilities,
    sources: { database: dbCapabilities.length, clickhouse: chCapabilities.length, merged: capabilities.length },
  });
  response.headers.set('Cache-Control', 'private, max-age=60');
  return response;
}
