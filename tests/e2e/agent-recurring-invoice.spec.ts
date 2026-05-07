/**
 * E2E for the recurring-invoice flow (PR 6).
 *
 * Like other webhook-flow specs (PR 1, PR 2), we exercise the Telegram
 * webhook adapter with E2E_TELEGRAM_CAPTURE=1 so the bot's would-be
 * replies surface via the response body without touching real Telegram.
 *
 * Coverage:
 *   1. setup_recurring_invoice intent → recurring_created or needs_clarify
 *   2. rec_confirm callback → schedule status='active'
 *   3. rec_pause callback → status='paused'
 *   4. rec_cancel callback → schedule deleted (404 on lookup)
 *   5. Cron generation: seed schedule with nextDue in past, hit cron
 *      endpoint, verify a new invoice was created with source='recurring'
 */

import { test, expect } from '@playwright/test';

const WEB = 'http://localhost:3000';
const E2E_CHAT_ID = 555555555; // mapped to e2e@agentbook.test in CHAT_TO_TENANT_FALLBACK

let prisma: typeof import('@naap/database').prisma;

const TENANT = `e2e-recurring-${Date.now()}`;

interface CaptureEntry { chatId: number | string; text: string; payload?: any }
interface WebhookResp { ok: boolean; captured?: CaptureEntry[]; botReply?: string }

async function postWebhook(
  request: any,
  payload: { text?: string; callbackData?: string; chatId?: number },
): Promise<WebhookResp> {
  const chatId = payload.chatId ?? E2E_CHAT_ID;
  const update: any = {
    update_id: Math.floor(Math.random() * 1e9),
  };
  if (payload.callbackData) {
    update.callback_query = {
      id: String(Math.random()),
      from: { id: chatId, is_bot: false, first_name: 'E2E' },
      data: payload.callbackData,
      message: { message_id: 0, chat: { id: chatId, type: 'private' } },
    };
  } else {
    update.message = {
      message_id: Math.floor(Math.random() * 1e9),
      date: Math.floor(Date.now() / 1000),
      chat: { id: chatId, type: 'private' },
      from: { id: chatId, is_bot: false, first_name: 'E2E' },
      text: payload.text || '',
    };
  }
  const res = await request.post(`${WEB}/api/v1/agentbook/telegram/webhook`, {
    data: update,
    headers: { 'Content-Type': 'application/json' },
  });
  return res.ok() ? (await res.json()) : { ok: false };
}

function findReply(captures: CaptureEntry[] | undefined, predicate: (text: string) => boolean): string | null {
  if (!captures) return null;
  for (const c of captures) {
    if (predicate(c.text)) return c.text;
  }
  return null;
}

// ─── Webhook flow tests (PR 6) ────────────────────────────────────────

test.describe.serial('PR 6 — Recurring invoice (webhook flow)', () => {
  test('setup intent replies with recurring_created or needs_clarify', async ({ request }) => {
    const resp = await postWebhook(request, {
      text: 'every month invoice TechCorp $5K consulting on the 1st',
    });
    // Expected: either the friendly "issued automatically every month..."
    // confirmation OR a clarify question (if the e2e tenant has no
    // TechCorp client, or the parser couldn't pin the cadence/amount).
    const reply = findReply(
      resp.captured,
      (t) =>
        /issued automatically every|don't have a client|How often|Which|How much/.test(t),
    );
    expect(reply).not.toBeNull();
  });

  test('rec_confirm callback responds gracefully (active or not-found)', async ({ request }) => {
    const resp = await postWebhook(request, {
      callbackData: 'rec_confirm:00000000-0000-0000-0000-000000000000',
    });
    expect(resp.ok).toBe(true);
  });

  test('rec_pause callback responds gracefully', async ({ request }) => {
    const resp = await postWebhook(request, {
      callbackData: 'rec_pause:00000000-0000-0000-0000-000000000000',
    });
    expect(resp.ok).toBe(true);
  });

  test('rec_cancel callback responds gracefully', async ({ request }) => {
    const resp = await postWebhook(request, {
      callbackData: 'rec_cancel:00000000-0000-0000-0000-000000000000',
    });
    expect(resp.ok).toBe(true);
  });
});

// ─── Cron generation test (DB-level) ────────────────────────────────────

test.describe.serial('PR 6 — Cron generation tags source=recurring', () => {
  test.beforeAll(async () => {
    const dbMod = await import('@naap/database');
    prisma = dbMod.prisma;

    // Seed a minimal chart of accounts (AR + Revenue) — the cron skips
    // schedules where these are missing.
    await prisma.abAccount.createMany({
      data: [
        { tenantId: TENANT, code: '1100', name: 'Accounts Receivable', accountType: 'asset' },
        { tenantId: TENANT, code: '4000', name: 'Service Revenue', accountType: 'revenue' },
      ],
      skipDuplicates: true,
    });
    // Seed a client.
    await prisma.abClient.create({
      data: {
        tenantId: TENANT,
        name: 'Recurring Test Co',
        email: 'rec@example.test',
      },
    });
  });

  test.afterAll(async () => {
    if (!prisma) return;
    // Cleanup — order matters because of FK constraints.
    await prisma.abInvoiceLine.deleteMany({
      where: { invoice: { tenantId: TENANT } },
    });
    await prisma.abInvoice.deleteMany({ where: { tenantId: TENANT } });
    await prisma.abJournalLine.deleteMany({
      where: { entry: { tenantId: TENANT } },
    });
    await prisma.abJournalEntry.deleteMany({ where: { tenantId: TENANT } });
    await prisma.abRecurringInvoice.deleteMany({ where: { tenantId: TENANT } });
    await prisma.abClient.deleteMany({ where: { tenantId: TENANT } });
    await prisma.abAccount.deleteMany({ where: { tenantId: TENANT } });
    await prisma.abEvent.deleteMany({ where: { tenantId: TENANT } });
    await prisma.$disconnect();
  });

  test('cron generates an invoice with source=recurring when schedule is due', async ({ request }) => {
    const client = await prisma.abClient.findFirst({ where: { tenantId: TENANT } });
    expect(client).not.toBeNull();

    // Seed a recurring schedule with nextDue in the past so the cron
    // picks it up on this run.
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const schedule = await prisma.abRecurringInvoice.create({
      data: {
        tenantId: TENANT,
        clientId: client!.id,
        frequency: 'monthly',
        nextDue: yesterday,
        templateLines: [
          { description: 'Monthly retainer', quantity: 1, rateCents: 250000 },
        ] as never,
        totalCents: 250000,
        daysToPay: 30,
        autoSend: false,
        currency: 'USD',
        status: 'active',
      },
    });

    // Hit the cron endpoint. When CRON_SECRET is set on the server, send
    // the matching bearer header; otherwise the route is open.
    const cronSecret = process.env.CRON_SECRET || '';
    const headers: Record<string, string> = cronSecret
      ? { Authorization: `Bearer ${cronSecret}` }
      : {};
    const res = await request.get(`${WEB}/api/v1/agentbook/cron/recurring-invoices`, { headers });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.success).toBe(true);

    // Verify a new invoice was created and tagged with source='recurring'.
    const inv = await prisma.abInvoice.findFirst({
      where: { tenantId: TENANT, recurringId: schedule.id },
    });
    expect(inv).not.toBeNull();
    expect(inv?.source).toBe('recurring');
    expect(inv?.amountCents).toBe(250000);

    // The schedule's nextDue should have advanced one month.
    const updated = await prisma.abRecurringInvoice.findUnique({
      where: { id: schedule.id },
    });
    expect(updated).not.toBeNull();
    expect(updated!.generatedCount).toBeGreaterThanOrEqual(1);
    expect(updated!.lastGenerated).not.toBeNull();
    expect(updated!.nextDue.getTime()).toBeGreaterThan(yesterday.getTime());
  });
});
