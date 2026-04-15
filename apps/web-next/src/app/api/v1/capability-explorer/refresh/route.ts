/**
 * POST /api/v1/capability-explorer/refresh
 *
 * Refresh the capability explorer merged view.
 * Accepts: CRON_SECRET (Vercel cron), session cookie (admin UI), or API key.
 */

export const runtime = 'nodejs';
export const maxDuration = 120;

import { NextRequest, NextResponse } from 'next/server';
import { authorize } from '@/lib/gateway/authorize';
import { getAuthToken } from '@/lib/api/response';
import { refreshCapabilities, isRefreshDue } from '@capability-explorer/backend';

async function handleRefresh(request: NextRequest): Promise<NextResponse> {
  const auth = await authorize(request);
  if (!auth) {
    return NextResponse.json(
      { success: false, error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } },
      { status: 401 },
    );
  }

  const due = await isRefreshDue();
  if (!due && auth.callerType === 'cron') {
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
