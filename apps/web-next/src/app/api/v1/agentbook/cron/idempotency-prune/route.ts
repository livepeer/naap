/**
 * Idempotency-key housekeeping cron (PR 21).
 *
 * Drops `AbIdempotencyKey` rows older than 24 hours. Telegram's retry
 * window is far shorter — anything past a day has zero chance of being
 * a meaningful replay, so the row is just dead weight.
 *
 * Vercel cron suggested: "15 4 * * *" (04:15 UTC, off-peak).
 * Idempotent — same-day reruns just delete fewer rows.
 * Bearer-gated when `CRON_SECRET` is set.
 */

import 'server-only';
import { timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { pruneIdempotencyKeys } from '@/lib/agentbook-idempotency';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

function safeCompareBearer(provided: string | null, expected: string): boolean {
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(`Bearer ${expected}`);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const authHeader = request.headers.get('authorization');
  if (
    process.env.CRON_SECRET &&
    !safeCompareBearer(authHeader, process.env.CRON_SECRET)
  ) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await pruneIdempotencyKeys({ olderThanHours: 24 });
    return NextResponse.json({
      success: true,
      data: { deleted: result.deleted, retentionHours: 24 },
    });
  } catch (err) {
    console.error('[cron/idempotency-prune] failed:', err);
    return NextResponse.json(
      { success: false, error: 'prune failed' },
      { status: 500 },
    );
  }
}
