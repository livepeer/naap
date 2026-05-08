/**
 * Dead-letter replay cron (PR 23).
 *
 * Sweeps every open `AbWebhookDeadLetter` row once a day and tries to
 * replay it through the local Telegram webhook. Successful replays
 * set `resolvedAt`; failures bump `attempts` and update the latest
 * error message so an operator can see what's still broken.
 *
 * Vercel cron suggested: "30 4 * * *" (04:30 UTC, off-peak — runs
 * 15min after the idempotency-prune cron so we don't compete for a
 * tiny db). Bearer-gated when `CRON_SECRET` is set.
 */

import 'server-only';
import { timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { replayOpenDeadLetters } from '@/lib/agentbook-dead-letter';

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

function inferWebhookUrl(request: NextRequest): string {
  // Prefer an explicit override (handy for cross-host replays in test
  // envs); otherwise build from the cron request's own origin.
  if (process.env.AGENTBOOK_TELEGRAM_WEBHOOK_URL) {
    return process.env.AGENTBOOK_TELEGRAM_WEBHOOK_URL;
  }
  const url = new URL(request.url);
  return `${url.protocol}//${url.host}/api/v1/agentbook/telegram/webhook`;
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
    const result = await replayOpenDeadLetters({
      webhookUrl: inferWebhookUrl(request),
    });
    return NextResponse.json({ success: true, data: result });
  } catch (err) {
    console.error('[cron/dead-letter-replay] failed:', err);
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}
