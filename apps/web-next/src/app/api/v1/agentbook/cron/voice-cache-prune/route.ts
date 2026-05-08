/**
 * Voice-transcript cache housekeeping cron (PR 19).
 *
 * Drops `AbVoiceTranscript` rows older than 30 days. The cache is for
 * dedup of replays and retries — tenants don't expect to "look up"
 * transcripts after the conversation moves on, so 30 days is a
 * generous retention window. The `file_id` from Telegram itself is
 * unstable longer-term (Telegram garbage-collects file paths after a
 * while), so caching beyond a month buys us nothing.
 *
 * Vercel cron suggested: "30 4 * * *" (04:30 UTC, off-peak).
 * Idempotent — same-day reruns just delete fewer rows.
 * Bearer-gated when `CRON_SECRET` is set.
 */

import 'server-only';
import { timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { pruneVoiceTranscripts } from '@/lib/agentbook-voice-cache';

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
    const result = await pruneVoiceTranscripts({ olderThanDays: 30 });
    return NextResponse.json({
      success: true,
      data: { deleted: result.deleted, retentionDays: 30 },
    });
  } catch (err) {
    console.error('[cron/voice-cache-prune] failed:', err);
    return NextResponse.json(
      { success: false, error: 'prune failed' },
      { status: 500 },
    );
  }
}
