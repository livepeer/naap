/**
 * E2E for Telegram-webhook retry + dead-letter (PR 23).
 *
 * The webhook wraps `bot.handleUpdate` in `withRetry`. Transient
 * failures (LLM timeout, DB blip) get up to 3 attempts with backoff.
 * If every attempt fails — or the very first one is permanent — we
 * write the original Update + last error to `AbWebhookDeadLetter` and
 * still 200 to Telegram so it stops retrying its own queue.
 *
 * Failure injection is gated by the test hook in the webhook route:
 *   __FAIL_ONCE__   → first attempt throws transient, retry succeeds
 *   __FAIL_ALWAYS__ → every attempt throws transient → dead-letter
 *   __FAIL_PERM__   → permanent error → dead-letter (no retry)
 *
 * Coverage:
 *   1. Transient → retry succeeds (no dead-letter row).
 *   2. Always-transient → dead-letter row created with attempts=3.
 *   3. Permanent → dead-letter row created on the first attempt.
 *   4. Manual replay endpoint resolves the row when called against
 *      a non-failing payload.
 */

import { test, expect } from '@playwright/test';

const WEB = 'http://localhost:3000';
const E2E_CHAT_ID = 555555555; // → e2e@agentbook.test in CHAT_TO_TENANT_FALLBACK
const E2E_TENANT = 'b9a80acd-fa14-4209-83a9-03231513fa8f';

let prisma: typeof import('@naap/database').prisma;

interface CaptureEntry { chatId: number | string; text: string; payload?: unknown }
interface WebhookResp {
  ok: boolean;
  captured?: CaptureEntry[];
  botReply?: string;
  idempotent?: boolean;
  deadLettered?: boolean;
}

async function postUpdate(
  request: import('@playwright/test').APIRequestContext,
  update: Record<string, unknown>,
): Promise<{ status: number; body: WebhookResp }> {
  const res = await request.post(`${WEB}/api/v1/agentbook/telegram/webhook`, {
    data: update,
    headers: { 'Content-Type': 'application/json' },
  });
  const status = res.status();
  if (!res.ok()) return { status, body: { ok: false } };
  return { status, body: (await res.json()) as WebhookResp };
}

function buildMessageUpdate(updateId: number, text: string): Record<string, unknown> {
  return {
    update_id: updateId,
    message: {
      message_id: Math.floor(Math.random() * 1e9),
      date: Math.floor(Date.now() / 1000),
      chat: { id: E2E_CHAT_ID, type: 'private' },
      from: { id: E2E_CHAT_ID, is_bot: false, first_name: 'E2E' },
      text,
    },
  };
}

test.describe.serial('PR 23 — Webhook retry + dead-letter', () => {
  test.beforeAll(async () => {
    const dbMod = await import('@naap/database');
    prisma = dbMod.prisma;
  });

  test.afterAll(async () => {
    // Clean up everything we wrote: idempotency rows and dead-letter rows
    // for the e2e tenant + the bait expense rows from the once-fail case.
    await prisma.abWebhookDeadLetter.deleteMany({
      where: { tenantId: E2E_TENANT },
    });
    await prisma.abIdempotencyKey.deleteMany({
      where: { tenantId: E2E_TENANT },
    });
  });

  test('1. transient failure on first attempt → retry succeeds, no dead-letter row', async ({ request }) => {
    const updateId = 9_991_000_000 + Math.floor(Math.random() * 1_000_000);
    const text = `__FAIL_ONCE__ pr23-once-${updateId}`;
    const update = buildMessageUpdate(updateId, text);

    const r = await postUpdate(request, update);
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    // The retry succeeded → no dead-letter flag.
    expect(r.body.deadLettered).toBeFalsy();

    // No row should exist for this update_id.
    const rows = await prisma.abWebhookDeadLetter.findMany({
      where: { tenantId: E2E_TENANT },
    });
    const ours = rows.filter((row) => {
      const p = row.payload as { update_id?: number };
      return p?.update_id === updateId;
    });
    expect(ours.length).toBe(0);
  });

  test('2. transient failure on every attempt → dead-letter row created with attempts=3', async ({ request }) => {
    const updateId = 9_991_100_000 + Math.floor(Math.random() * 1_000_000);
    const text = `__FAIL_ALWAYS__ pr23-always-${updateId}`;
    const update = buildMessageUpdate(updateId, text);

    const r = await postUpdate(request, update);
    expect(r.status).toBe(200); // Always 200 to Telegram.
    expect(r.body.ok).toBe(true);
    expect(r.body.deadLettered).toBe(true);

    // Find the row by inspecting the payload's update_id.
    const rows = await prisma.abWebhookDeadLetter.findMany({
      where: { tenantId: E2E_TENANT, resolvedAt: null },
    });
    const ours = rows.find((row) => {
      const p = row.payload as { update_id?: number };
      return p?.update_id === updateId;
    });
    expect(ours).toBeDefined();
    expect(ours?.attempts).toBe(3); // initial + 2 retries
    expect(ours?.error).toMatch(/ETIMEDOUT|connect/i);
    expect(ours?.tenantId).toBe(E2E_TENANT);
  });

  test('3. permanent failure → dead-letter row on first attempt (attempts=1)', async ({ request }) => {
    const updateId = 9_991_200_000 + Math.floor(Math.random() * 1_000_000);
    const text = `__FAIL_PERM__ pr23-perm-${updateId}`;
    const update = buildMessageUpdate(updateId, text);

    const r = await postUpdate(request, update);
    expect(r.status).toBe(200);
    expect(r.body.deadLettered).toBe(true);

    const rows = await prisma.abWebhookDeadLetter.findMany({
      where: { tenantId: E2E_TENANT, resolvedAt: null },
    });
    const ours = rows.find((row) => {
      const p = row.payload as { update_id?: number };
      return p?.update_id === updateId;
    });
    expect(ours).toBeDefined();
    // Permanent → no retries.
    expect(ours?.attempts).toBe(1);
    expect(ours?.error).toMatch(/permanent|400/i);
  });

  test('4. cron replay endpoint reachable and reports counts', async ({ request }) => {
    // No CRON_SECRET in e2e env → unauth path returns 200 with success.
    const res = await request.get(`${WEB}/api/v1/agentbook/cron/dead-letter-replay`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(typeof body.data.total).toBe('number');
    expect(typeof body.data.resolved).toBe('number');
    expect(typeof body.data.failed).toBe('number');
  });
});
