/**
 * GET /api/v1/orchestrator-leaderboard/filters
 *
 * Returns available filter options (distinct capability names) from the
 * persistent LeaderboardDatasetRow table. Also merges warm capabilities
 * from ClickHouse (last hour) for real-time coverage.
 */

export const runtime = 'nodejs';
export const maxDuration = 30;

import { timingSafeEqual } from 'node:crypto';
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
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const auth = request.headers.get('authorization');
  if (!auth) return false;
  const expected = `Bearer ${secret}`;
  const authBuf = Buffer.from(auth, 'utf8');
  const expectedBuf = Buffer.from(expected, 'utf8');
  if (authBuf.length !== expectedBuf.length) return false;
  return timingSafeEqual(authBuf, expectedBuf);
}

function sanitizeCapabilityRows(rows: unknown[]): Array<{ capability_name: string }> {
  const out: Array<{ capability_name: string }> = [];
  for (const row of rows) {
    if (row === null || typeof row !== 'object') continue;
    if (!Object.prototype.hasOwnProperty.call(row, 'capability_name')) continue;
    const name = (row as { capability_name: unknown }).capability_name;
    if (typeof name !== 'string') continue;
    const trimmed = name.trim();
    if (!trimmed) continue;
    out.push({ capability_name: trimmed });
  }
  return out;
}

function parseCapabilityRows(json: unknown): Array<{ capability_name: string }> {
  if (Array.isArray(json)) return sanitizeCapabilityRows(json);
  const data = (json as { data?: unknown }).data;
  if (Array.isArray(data)) return sanitizeCapabilityRows(data);
  const nested = (data as { data?: unknown } | undefined)?.data;
  if (Array.isArray(nested)) return sanitizeCapabilityRows(nested);
  return [];
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
  };
  if (authToken) {
    headers.Authorization = `Bearer ${authToken}`;
  }

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
      chCapabilities = parseCapabilityRows(json).map((row) => row.capability_name);
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
