/**
 * POST /api/v1/capability-explorer/refresh
 *
 * Cron-triggered refresh of the capability explorer merged view.
 * Protected by CRON_SECRET (same pattern as orchestrator-leaderboard).
 */

export const runtime = 'nodejs';
export const maxDuration = 120;

import { NextRequest, NextResponse } from 'next/server';
import { getAuthToken } from '@/lib/api/response';
import { refreshCapabilities, isRefreshDue } from '@capability-explorer/backend';

function authorized(request: NextRequest): boolean {
  const auth = request.headers.get('authorization');
  return Boolean(process.env.CRON_SECRET) && auth === `Bearer ${process.env.CRON_SECRET}`;
}

async function handleRefresh(request: NextRequest): Promise<NextResponse> {
  if (!authorized(request)) {
    return NextResponse.json(
      { success: false, error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } },
      { status: 401 },
    );
  }

  const due = await isRefreshDue();
  if (!due) {
    return NextResponse.json({
      success: true,
      data: { skipped: true, reason: 'Refresh not due yet' },
    });
  }

  const authToken = getAuthToken(request) || process.env.CRON_SECRET || '';

  try {
    const result = await refreshCapabilities({
      authToken,
      requestUrl: request.url,
      cookieHeader: request.headers.get('cookie'),
    });
    return NextResponse.json({ success: true, data: result });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Refresh failed';
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message } },
      { status: 500 },
    );
  }
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  return handleRefresh(request);
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  return handleRefresh(request);
}
