/**
 * E2E for the bot rate-limit gate (PR 25).
 *
 * Per-tenant ceilings of 60 messages/minute and 1000/day. Beyond the
 * ceiling we send a polite throttle reply — never silently drop —
 * and respond `200 { ok: true, throttled: true }` to the webhook.
 *
 * This spec hammers the webhook with 65 distinct update_ids in quick
 * succession. The first 60 should sail through (`throttled` falsy),
 * and at least one of the trailing five should come back with
 * `throttled: true` and a captured throttle reply.
 *
 * We use distinct update_ids because the idempotency dedup (PR 21)
 * would short-circuit identical update_ids before the rate-limit gate
 * even runs. We also pre-clean the rate-limit AbUserMemory rows so a
 * previous test run can't poison the count.
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
  throttled?: boolean;
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

test.describe.serial('PR 25 — Bot rate limits', () => {
  test.beforeAll(async () => {
    const dbMod = await import('@naap/database');
    prisma = dbMod.prisma;
  });

  test.beforeEach(async () => {
    // Clear rate-limit counter rows so each test starts at zero.
    await prisma.abUserMemory.deleteMany({
      where: {
        tenantId: E2E_TENANT,
        key: { startsWith: 'rate:' },
      },
    });
    // Also clear idempotency rows so we don't get short-circuited by a
    // colliding update_id from a previous run.
    await prisma.abIdempotencyKey.deleteMany({
      where: { tenantId: E2E_TENANT },
    });
  });

  test.afterAll(async () => {
    await prisma.abUserMemory.deleteMany({
      where: {
        tenantId: E2E_TENANT,
        key: { startsWith: 'rate:' },
      },
    });
    await prisma.abIdempotencyKey.deleteMany({
      where: { tenantId: E2E_TENANT },
    });
    await prisma.abExpense.deleteMany({
      where: {
        tenantId: E2E_TENANT,
        description: { startsWith: 'pr25-rate-' },
      },
    });
  });

  test('rapid-fire 65 messages — at least one is throttled with a polite reply', async ({ request }) => {
    test.setTimeout(120_000); // 65 sequential webhook calls can be slow

    const baseId = 9_995_000_000 + Math.floor(Math.random() * 1_000_000);
    const results: WebhookResp[] = [];

    for (let i = 0; i < 65; i++) {
      const text = `pr25-rate-${baseId + i} ping`;
      const r = await postUpdate(request, buildMessageUpdate(baseId + i, text));
      expect(r.status).toBe(200);
      results.push(r.body);
    }

    // First 60 should not be throttled.
    for (let i = 0; i < 60; i++) {
      expect(
        results[i].throttled,
        `message ${i} should have been allowed but was throttled`,
      ).toBeFalsy();
    }

    // At least one of the last five should be throttled.
    const throttledTail = results.slice(60).filter((r) => r.throttled === true);
    expect(throttledTail.length).toBeGreaterThan(0);

    // The throttle reply text should be present in the captured buf.
    const throttledWithReply = throttledTail.find(
      (r) => typeof r.botReply === 'string' && /catch up|Daily limit/i.test(r.botReply),
    );
    expect(
      throttledWithReply,
      'expected at least one throttled response to carry the polite throttle reply',
    ).toBeTruthy();

    // The minute-counter row should exist for this tenant + telegram channel.
    const counterRow = await prisma.abUserMemory.findUnique({
      where: { tenantId_key: { tenantId: E2E_TENANT, key: 'rate:telegram:minute' } },
    });
    expect(counterRow).not.toBeNull();
    const state = JSON.parse(counterRow!.value) as { bucket: number; count: number };
    expect(state.count).toBeGreaterThanOrEqual(60);
  });
});
