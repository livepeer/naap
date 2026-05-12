/**
 * POST /api/v1/orchestrator-leaderboard/dataset/refresh
 *
 * Time-gated global dataset refresh. Two auth paths:
 *   1. CRON_SECRET — Vercel cron (hourly). Checks elapsed time vs
 *      configured interval; skips if not enough time has passed.
 *   2. User JWT with system:admin — manual "Refresh Now" from the UI.
 *      Bypasses the time gate and forces an immediate refresh.
 */

export const runtime = 'nodejs';
export const maxDuration = 120;

import { NextRequest, NextResponse } from 'next/server';
import { validateSession } from '@/lib/api/auth';
import { getAuthToken } from '@/lib/api/response';
import { getRefreshIntervalMs } from '@/lib/orchestrator-leaderboard/config';
import { isGlobalDatasetFresh } from '@/lib/orchestrator-leaderboard/global-dataset';
import { refreshGlobalDataset } from '@/lib/orchestrator-leaderboard/global-refresh';

function isCronAuth(request: NextRequest): boolean {
  const auth = request.headers.get('authorization');
  return Boolean(process.env.CRON_SECRET) && auth === `Bearer ${process.env.CRON_SECRET}`;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const cronAuthed = isCronAuth(request);

  let adminUserId: string | null = null;
  if (!cronAuthed) {
    const token = getAuthToken(request);
    if (!token) {
      return NextResponse.json(
        { success: false, error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } },
        { status: 401 },
      );
    }

    const user = await validateSession(token);
    if (!user || !user.roles.includes('system:admin')) {
      return NextResponse.json(
        { success: false, error: { code: 'FORBIDDEN', message: 'Admin permission required' } },
        { status: 403 },
      );
    }
    adminUserId = user.id;
  }

  const intervalMs = await getRefreshIntervalMs();

  // Cron path: skip if the dataset is still fresh
  if (cronAuthed && isGlobalDatasetFresh(intervalMs)) {
    return NextResponse.json({
      success: true,
      data: {
        skipped: true,
        reason: 'Global dataset is still fresh',
        nextRefreshInMs: intervalMs,
      },
    });
  }

  const authToken = getAuthToken(request) || process.env.CRON_SECRET || '';
  const refreshedBy = adminUserId ? `admin:${adminUserId}` : 'cron';

  try {
    const result = await refreshGlobalDataset(
      refreshedBy,
      authToken,
      request.url,
      request.headers.get('cookie'),
    );
    return NextResponse.json({ success: true, data: result });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Refresh failed';
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message } },
      { status: 500 },
    );
  }
}
