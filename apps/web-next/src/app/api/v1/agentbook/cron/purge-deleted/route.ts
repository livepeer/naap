/**
 * Daily soft-delete purge cron (PR 26).
 *
 * Hard-deletes financial-entity rows whose `deletedAt` is more than 90
 * days old. The 90-day window is the user's last chance to undo a delete
 * via `/agentbook-core/restore/:entityType/:id` — past it, the row has
 * been off the books long enough that we'd rather reclaim the space
 * (and limit GDPR-style "is it really gone?" surface area).
 *
 * Vercel cron suggested: "30 4 * * *" (04:30 UTC, after the
 * idempotency-prune cron). Idempotent — same-day reruns find nothing
 * new to drop. Bearer-gated when `CRON_SECRET` is set.
 */

import 'server-only';
import { timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { purgeSoftDeleted } from '@/lib/agentbook-purge-deleted';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

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
    const result = await purgeSoftDeleted();
    return NextResponse.json({ success: true, data: result });
  } catch (err) {
    console.error('[cron/purge-deleted] failed:', err);
    return NextResponse.json(
      { success: false, error: 'purge failed' },
      { status: 500 },
    );
  }
}
