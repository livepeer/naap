/**
 * Daily backup cron (PR 24).
 *
 * Snapshots every opted-in tenant's business-critical entities to a
 * ZIPped CSV bundle on Vercel Blob, persists an `AbBackup` audit row,
 * and notifies the tenant via Telegram with a one-tap download link.
 *
 * Vercel cron suggested: "0 5 * * *" (05:00 UTC, off-peak — runs after
 * the dead-letter sweep + idempotency-prune so we don't compete for
 * the same DB during the maintenance window).
 *
 * Bearer-gated when `CRON_SECRET` is set. Per-tenant fan-out is bounded
 * to 3 because each iteration uploads a multi-KB blob — higher
 * concurrency starts to thrash the storage layer for diminishing
 * returns. Tenants who opted out (`AbTenantConfig.dailyBackupEnabled
 * = false`) are skipped before any DB read so an opt-out is a true
 * no-op.
 */

import 'server-only';
import { timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { prisma as db } from '@naap/database';
import { buildAndUploadBackup } from '@/lib/agentbook-backup';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const CONCURRENCY = 3;

function safeCompareBearer(
  provided: string | null,
  expected: string,
): boolean {
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(`Bearer ${expected}`);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `~${Math.round(bytes / 1024)} KB`;
  return `~${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface TenantResult {
  tenantId: string;
  ok: boolean;
  url?: string;
  sizeBytes?: number;
  notified?: boolean;
  error?: string;
}

/**
 * Telegram message — 24h hint is informational; Vercel Blob URLs are
 * already public-by-token, so the link is usable as-is. Wording mirrors
 * the spec ("Backup ready (~12 KB)").
 */
async function sendBackupNotification(
  tenantId: string,
  url: string,
  sizeBytes: number,
): Promise<boolean> {
  const bot = await db.abTelegramBot.findFirst({
    where: { tenantId, enabled: true },
  });
  if (!bot) return false;
  const chats = Array.isArray(bot.chatIds) ? (bot.chatIds as string[]) : [];
  if (chats.length === 0) return false;

  const text = `🛟 Backup ready (${fmtSize(sizeBytes)}) — <a href="${url}">download</a> (link valid 24h)`;

  let anySent = false;
  for (const chatId of chats) {
    try {
      const res = await fetch(
        `https://api.telegram.org/bot${bot.botToken}/sendMessage`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text,
            parse_mode: 'HTML',
            disable_web_page_preview: true,
          }),
        },
      );
      if (res.ok) anySent = true;
    } catch {
      // Telegram outages must not fail the backup — the row already
      // landed in `AbBackup`, the user can find the URL via the UI.
    }
  }
  return anySent;
}

async function processOne(tenantId: string): Promise<TenantResult> {
  try {
    const result = await buildAndUploadBackup(tenantId);
    let notified = false;
    try {
      notified = await sendBackupNotification(
        tenantId,
        result.url,
        result.sizeBytes,
      );
    } catch (err) {
      console.warn('[cron/daily-backup] notify failed', tenantId, err);
    }
    return {
      tenantId,
      ok: true,
      url: result.url,
      sizeBytes: result.sizeBytes,
      notified,
    };
  } catch (err) {
    console.error('[cron/daily-backup] tenant error', tenantId, err);
    return {
      tenantId,
      ok: false,
      // Sanitised: never leak the raw stack to the cron response — the
      // outer 500 path only sees the category. Per-tenant failure stays
      // in the per-tenant entry as a short message.
      error: err instanceof Error ? err.message : 'unknown',
    };
  }
}

/**
 * Bounded-concurrency fan-out. Identical shape to the helper used by
 * the tax-package receipts ZIP — kept inline so this cron has no
 * extra dep.
 */
async function processAll<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  const runners: Promise<void>[] = [];
  const n = Math.max(1, Math.min(limit, items.length));
  for (let i = 0; i < n; i += 1) {
    runners.push(
      (async () => {
        for (;;) {
          const idx = cursor;
          cursor += 1;
          if (idx >= items.length) return;
          out[idx] = await worker(items[idx]);
        }
      })(),
    );
  }
  await Promise.all(runners);
  return out;
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
    // Tenant set: anyone who has a config row (always present after
    // first login) AND hasn't opted out. The `findMany` short-circuits
    // opt-outs at the DB layer so we don't even build a buffer for
    // tenants who don't want the cron to touch their data.
    const tenants = await db.abTenantConfig.findMany({
      where: { dailyBackupEnabled: true },
      select: { userId: true },
    });
    const tenantIds = tenants.map((t) => t.userId);

    const results = await processAll(tenantIds, CONCURRENCY, processOne);

    const ok = results.filter((r) => r.ok).length;
    const failed = results.length - ok;

    return NextResponse.json({
      success: true,
      data: {
        total: results.length,
        ok,
        failed,
        results,
      },
    });
  } catch (err) {
    console.error('[cron/daily-backup] failed:', err);
    // Sanitised: don't echo stack traces to the cron response. Vercel
    // logs already have the structured error.
    return NextResponse.json(
      { success: false, error: 'backup failed' },
      { status: 500 },
    );
  }
}
