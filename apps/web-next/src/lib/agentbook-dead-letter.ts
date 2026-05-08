/**
 * Dead-letter replay helpers (PR 23).
 *
 * The Telegram webhook writes to `AbWebhookDeadLetter` when retries
 * have been exhausted. This module owns the replay contract:
 *
 *   - `replayDeadLetter`     — re-runs a single row through the local
 *                              webhook endpoint. On 200, marks the row
 *                              resolved. On failure, bumps the attempt
 *                              counter and updates the error.
 *   - `replayOpenDeadLetters` — sweeps every open row (resolvedAt IS
 *                              NULL), capped to a sensible page size
 *                              so a stuck row doesn't burn the cron
 *                              budget.
 *
 * Tenant scope: the replay endpoint passes a tenantId filter when one
 * is provided (the admin UI is per-tenant). The cron path is global —
 * it runs as the system identity to drain backlog regardless of who
 * owns the row.
 */

import 'server-only';
import { prisma as db } from '@naap/database';

export interface ReplayResult {
  id: string;
  ok: boolean;
  /** HTTP status from the webhook re-post, if we got that far. */
  status?: number;
  /** Error message if the replay attempt itself threw. */
  error?: string;
}

export interface ReplayBatchResult {
  total: number;
  resolved: number;
  failed: number;
  results: ReplayResult[];
}

/**
 * Replay a single dead-letter row. Posts the original Update payload
 * back to the webhook (the idempotency layer keeps this safe — a
 * recovered row will short-circuit on its cached key if the original
 * partially succeeded). On HTTP 200 the row is marked resolved.
 */
export async function replayDeadLetter(
  id: string,
  opts: { webhookUrl: string; tenantId?: string },
): Promise<ReplayResult> {
  const where: { id: string; tenantId?: string; resolvedAt: null } = {
    id,
    resolvedAt: null,
  };
  if (opts.tenantId) where.tenantId = opts.tenantId;

  const row = await db.abWebhookDeadLetter.findFirst({ where });
  if (!row) {
    return { id, ok: false, error: 'not found or already resolved' };
  }

  try {
    const res = await fetch(opts.webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // The webhook accepts replays without the Telegram secret when
        // E2E_CAPTURE is on (tests) or when called from the same host
        // by an authenticated cron. We pass the secret if we have it.
        ...(process.env.TELEGRAM_WEBHOOK_SECRET
          ? { 'X-Telegram-Bot-Api-Secret-Token': process.env.TELEGRAM_WEBHOOK_SECRET }
          : {}),
      },
      body: JSON.stringify(row.payload),
    });

    if (res.ok) {
      await db.abWebhookDeadLetter.update({
        where: { id: row.id },
        data: { resolvedAt: new Date(), attempts: row.attempts + 1 },
      });
      return { id: row.id, ok: true, status: res.status };
    }

    // Non-200: bump attempts + record the latest status as the error.
    const text = await res.text().catch(() => '');
    const errMsg = `replay HTTP ${res.status}: ${text.slice(0, 500)}`;
    await db.abWebhookDeadLetter.update({
      where: { id: row.id },
      data: {
        attempts: row.attempts + 1,
        attemptedAt: new Date(),
        error: errMsg.slice(0, 2000),
      },
    });
    return { id: row.id, ok: false, status: res.status, error: errMsg };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    await db.abWebhookDeadLetter.update({
      where: { id: row.id },
      data: {
        attempts: row.attempts + 1,
        attemptedAt: new Date(),
        error: errMsg.slice(0, 2000),
      },
    }).catch(() => {});
    return { id: row.id, ok: false, error: errMsg };
  }
}

export interface ReplayBatchOptions {
  webhookUrl: string;
  /** Cap how many rows we attempt in one sweep. Default 50. */
  limit?: number;
}

/**
 * Walk every open dead-letter row and try to replay it once. Cron
 * entry point — designed to be run daily.
 */
export async function replayOpenDeadLetters(
  opts: ReplayBatchOptions,
): Promise<ReplayBatchResult> {
  const limit = opts.limit ?? 50;
  const open = await db.abWebhookDeadLetter.findMany({
    where: { resolvedAt: null },
    orderBy: { createdAt: 'asc' },
    take: limit,
  });

  const results: ReplayResult[] = [];
  let resolved = 0;
  let failed = 0;
  for (const row of open) {
    const r = await replayDeadLetter(row.id, { webhookUrl: opts.webhookUrl });
    results.push(r);
    if (r.ok) resolved++;
    else failed++;
  }
  return { total: open.length, resolved, failed, results };
}
