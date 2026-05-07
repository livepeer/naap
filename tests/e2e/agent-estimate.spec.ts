/**
 * E2E for the estimate flow (PR 7).
 *
 * Like other PR specs (PR 1, PR 2, PR 6), exercises the Telegram webhook
 * adapter with E2E_TELEGRAM_CAPTURE=1 so the bot's would-be replies
 * surface via the response body without touching real Telegram. Plus
 * direct hits against the new REST endpoints (accept / convert) using
 * the `x-tenant-id` header.
 *
 * Coverage:
 *   1. Create estimate via webhook ("estimate Test Beta $4K for new website")
 *   2. POST /accept flips status pending → approved
 *   3. POST /convert creates an invoice + sets convertedInvoiceId
 *   4. Idempotent convert: re-call returns the same invoice id
 *   5. Multi-line description handling (long description preserved)
 */

import { test, expect } from '@playwright/test';

const WEB = 'http://localhost:3000';
const E2E_CHAT_ID = 555555555; // mapped to e2e@agentbook.test in CHAT_TO_TENANT_FALLBACK

let prisma: typeof import('@naap/database').prisma;

const TENANT = `e2e-estimate-${Date.now()}`;

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

// ─── Webhook flow tests ───────────────────────────────────────────────

test.describe.serial('PR 7 — Create estimate (webhook flow)', () => {
  test('create_estimate intent replies with estimate_created or needs_clarify', async ({ request }) => {
    const resp = await postWebhook(request, {
      text: 'estimate Beta $4K for new website',
    });
    // Either "EST-… drafted, valid until …" OR a clarify question (e.g. no
    // Beta client on file in the e2e tenant).
    const reply = findReply(
      resp.captured,
      (t) => /drafted, valid until|don't have a client|Which client|estimate amount/.test(t),
    );
    expect(reply).not.toBeNull();
  });

  test('est_send callback responds gracefully', async ({ request }) => {
    const resp = await postWebhook(request, {
      callbackData: 'est_send:00000000-0000-0000-0000-000000000000',
    });
    expect(resp.ok).toBe(true);
  });

  test('est_cancel callback responds gracefully', async ({ request }) => {
    const resp = await postWebhook(request, {
      callbackData: 'est_cancel:00000000-0000-0000-0000-000000000000',
    });
    expect(resp.ok).toBe(true);
  });
});

// ─── REST endpoint tests (DB-level) ────────────────────────────────────

test.describe.serial('PR 7 — Estimate REST endpoints (accept / convert / idempotency)', () => {
  let clientId: string;
  let pendingEstimateId: string;
  let multiLineEstimateId: string;

  test.beforeAll(async () => {
    const dbMod = await import('@naap/database');
    prisma = dbMod.prisma;

    // Seed: client + chart of accounts (createInvoiceDraft just writes
    // AbInvoice — no AR/Revenue posting until inv_send, so we can skip
    // the chart of accounts here).
    const client = await prisma.abClient.create({
      data: { tenantId: TENANT, name: 'Estimate Test Co', email: 'estimate@example.test' },
    });
    clientId = client.id;

    const pending = await prisma.abEstimate.create({
      data: {
        tenantId: TENANT,
        clientId,
        amountCents: 400000,
        description: 'New website',
        status: 'pending',
        validUntil: new Date(Date.now() + 30 * 86_400_000),
      },
    });
    pendingEstimateId = pending.id;

    const multi = await prisma.abEstimate.create({
      data: {
        tenantId: TENANT,
        clientId,
        amountCents: 1500000,
        description:
          'Phase 1: Discovery & wireframes; Phase 2: Visual design + prototype; Phase 3: Development & QA; includes 2 rounds of revisions on each phase.',
        status: 'approved',
        validUntil: new Date(Date.now() + 30 * 86_400_000),
      },
    });
    multiLineEstimateId = multi.id;
  });

  test.afterAll(async () => {
    if (!prisma) return;
    // Order: invoice lines → invoices → estimates → client → events.
    await prisma.abInvoiceLine.deleteMany({ where: { invoice: { tenantId: TENANT } } });
    await prisma.abInvoice.deleteMany({ where: { tenantId: TENANT } });
    await prisma.abEstimate.deleteMany({ where: { tenantId: TENANT } });
    await prisma.abClient.deleteMany({ where: { tenantId: TENANT } });
    await prisma.abEvent.deleteMany({ where: { tenantId: TENANT } });
    await prisma.$disconnect();
  });

  test('POST /accept flips pending → approved', async ({ request }) => {
    const res = await request.post(
      `${WEB}/api/v1/agentbook-invoice/estimates/${pendingEstimateId}/accept`,
      { headers: { 'x-tenant-id': TENANT, 'Content-Type': 'application/json' }, data: {} },
    );
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.status).toBe('approved');

    const refreshed = await prisma.abEstimate.findUnique({ where: { id: pendingEstimateId } });
    expect(refreshed?.status).toBe('approved');
  });

  test('POST /convert creates an invoice and sets convertedInvoiceId', async ({ request }) => {
    const res = await request.post(
      `${WEB}/api/v1/agentbook-invoice/estimates/${pendingEstimateId}/convert`,
      { headers: { 'x-tenant-id': TENANT, 'Content-Type': 'application/json' }, data: {} },
    );
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.alreadyConverted).toBe(false);
    expect(body.data.invoice).not.toBeNull();
    expect(body.data.invoice.amountCents).toBe(400000);
    expect(body.data.invoiceNumber).toMatch(/^INV-\d{4}-\d{4}$/);

    const refreshed = await prisma.abEstimate.findUnique({ where: { id: pendingEstimateId } });
    expect(refreshed?.status).toBe('converted');
    expect(refreshed?.convertedInvoiceId).toBe(body.data.invoice.id);
  });

  test('Idempotent convert returns same invoice on re-call', async ({ request }) => {
    // Re-call POST /convert on the now-converted estimate. Should return
    // the SAME invoice id without creating a duplicate.
    const before = await prisma.abInvoice.count({ where: { tenantId: TENANT } });

    const res = await request.post(
      `${WEB}/api/v1/agentbook-invoice/estimates/${pendingEstimateId}/convert`,
      { headers: { 'x-tenant-id': TENANT, 'Content-Type': 'application/json' }, data: {} },
    );
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.alreadyConverted).toBe(true);

    const after = await prisma.abInvoice.count({ where: { tenantId: TENANT } });
    expect(after).toBe(before);

    const refreshed = await prisma.abEstimate.findUnique({ where: { id: pendingEstimateId } });
    expect(body.data.invoice.id).toBe(refreshed?.convertedInvoiceId);
  });

  test('Multi-line description survives convert', async ({ request }) => {
    const res = await request.post(
      `${WEB}/api/v1/agentbook-invoice/estimates/${multiLineEstimateId}/convert`,
      { headers: { 'x-tenant-id': TENANT, 'Content-Type': 'application/json' }, data: {} },
    );
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.invoice.lines.length).toBe(1);
    // The full estimate description should make it onto the invoice line
    // verbatim — both Phase markers must appear.
    const desc: string = body.data.invoice.lines[0].description;
    expect(desc).toContain('Phase 1');
    expect(desc).toContain('Phase 3');
    expect(body.data.invoice.amountCents).toBe(1500000);
  });
});
