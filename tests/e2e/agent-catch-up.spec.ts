/**
 * E2E for catch-me-up (PR 20).
 *
 * Coverage:
 *   1. GET /catch-up returns a tenant-scoped CatchUpSummary with the
 *      buckets correctly aggregated for activity since `?since=`.
 *   2. Default window — no `?since=` → 24h ago default; we still get
 *      a summary (success=true, sinceAt populated).
 *   3. Cross-tenant — sibling tenant's recent expense / invoice does
 *      NOT appear in tenant A's summary.
 *   4. Bot intent — POST telegram webhook with "catch me up" → reply
 *      contains the "Catch-up" header.
 *   5. Sanitised 500 — invalid `since` doesn't crash; falls back to 24h.
 */

import { test, expect } from '@playwright/test';

const WEB = 'http://localhost:3000';
const TENANT_A = `e2e-catchup-a-${Date.now()}`;
const TENANT_B = `e2e-catchup-b-${Date.now()}`;
const E2E_CHAT_ID = 555555555; // Maps to e2e@agentbook.test in CHAT_TO_TENANT_FALLBACK

let prisma: typeof import('@naap/database').prisma;

interface CaptureEntry { chatId: number | string; text: string; payload?: unknown }
interface WebhookResp { ok: boolean; captured?: CaptureEntry[]; botReply?: string }

async function postWebhook(
  request: import('@playwright/test').APIRequestContext,
  text: string,
): Promise<WebhookResp> {
  const update = {
    update_id: Math.floor(Math.random() * 1e9),
    message: {
      message_id: Math.floor(Math.random() * 1e9),
      date: Math.floor(Date.now() / 1000),
      chat: { id: E2E_CHAT_ID, type: 'private' },
      from: { id: E2E_CHAT_ID, is_bot: false, first_name: 'E2E' },
      text,
    },
  };
  const res = await request.post(`${WEB}/api/v1/agentbook/telegram/webhook`, {
    data: update,
    headers: { 'Content-Type': 'application/json' },
  });
  if (!res.ok()) return { ok: false };
  return (await res.json()) as WebhookResp;
}

test.describe.serial('PR 20 — Catch-me-up', () => {
  let sinceIso = '';

  test.beforeAll(async () => {
    const dbMod = await import('@naap/database');
    prisma = dbMod.prisma;

    // sinceAt = 1 hour ago. Everything we seed will fall in the window.
    sinceIso = new Date(Date.now() - 60 * 60 * 1000).toISOString();

    // ── Tenant A — full activity matrix ────────────────────────────────
    // 2 paid invoices ($800, $1200) — counts in invoicesPaid.
    const inv1 = await prisma.abClient.create({
      data: { tenantId: TENANT_A, name: 'Catchup Client A1', email: 'a1@catchup.test' },
    });
    await prisma.abInvoice.create({
      data: {
        tenantId: TENANT_A,
        clientId: inv1.id,
        number: `CU-A-${Date.now()}-1`,
        amountCents: 80_000,
        currency: 'USD',
        status: 'paid',
        issuedDate: new Date(),
        dueDate: new Date(Date.now() + 30 * 86_400_000),
      },
    });
    await prisma.abInvoice.create({
      data: {
        tenantId: TENANT_A,
        clientId: inv1.id,
        number: `CU-A-${Date.now()}-2`,
        amountCents: 120_000,
        currency: 'USD',
        status: 'paid',
        issuedDate: new Date(),
        dueDate: new Date(Date.now() + 30 * 86_400_000),
      },
    });
    // 1 sent invoice ($400)
    await prisma.abInvoice.create({
      data: {
        tenantId: TENANT_A,
        clientId: inv1.id,
        number: `CU-A-${Date.now()}-3`,
        amountCents: 40_000,
        currency: 'USD',
        status: 'sent',
        issuedDate: new Date(),
        dueDate: new Date(Date.now() + 30 * 86_400_000),
      },
    });

    // 1 confirmed+categorised expense, 1 pending_review
    await prisma.abExpense.create({
      data: {
        tenantId: TENANT_A,
        amountCents: 5_000,
        date: new Date(),
        description: 'AWS — auto-cat',
        categoryId: 'fake-cat',
        status: 'confirmed',
        isPersonal: false,
        currency: 'USD',
        source: 'bank_sync',
      },
    });
    await prisma.abExpense.create({
      data: {
        tenantId: TENANT_A,
        amountCents: 7_500,
        date: new Date(),
        description: 'Mystery vendor — needs review',
        status: 'pending_review',
        isPersonal: false,
        currency: 'USD',
        source: 'bank_sync',
      },
    });

    // ── Tenant B — sibling activity that must NOT leak into A ─────────
    const invB = await prisma.abClient.create({
      data: { tenantId: TENANT_B, name: 'Catchup Client B1', email: 'b1@catchup.test' },
    });
    await prisma.abInvoice.create({
      data: {
        tenantId: TENANT_B,
        clientId: invB.id,
        number: `CU-B-${Date.now()}-1`,
        amountCents: 999_999,
        currency: 'USD',
        status: 'paid',
        issuedDate: new Date(),
        dueDate: new Date(Date.now() + 30 * 86_400_000),
      },
    });
    await prisma.abExpense.create({
      data: {
        tenantId: TENANT_B,
        amountCents: 999_999,
        date: new Date(),
        description: 'B-only expense',
        categoryId: 'fake-cat',
        status: 'confirmed',
        isPersonal: false,
        currency: 'USD',
        source: 'manual',
      },
    });
  });

  test.afterAll(async () => {
    for (const tenantId of [TENANT_A, TENANT_B]) {
      await prisma.abInvoice.deleteMany({ where: { tenantId } });
      await prisma.abExpense.deleteMany({ where: { tenantId } });
      await prisma.abClient.deleteMany({ where: { tenantId } });
    }
  });

  test('1. GET /catch-up returns aggregated buckets for tenant A', async ({ request }) => {
    const res = await request.get(`${WEB}/api/v1/agentbook-core/catch-up?since=${encodeURIComponent(sinceIso)}`, {
      headers: { 'x-tenant-id': TENANT_A },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.invoicesPaid.count).toBeGreaterThanOrEqual(2);
    expect(body.data.invoicesPaid.totalCents).toBeGreaterThanOrEqual(200_000);
    expect(body.data.invoicesSent.count).toBeGreaterThanOrEqual(1);
    expect(body.data.invoicesSent.totalCents).toBeGreaterThanOrEqual(40_000);
    expect(body.data.expensesAutoCategorized).toBeGreaterThanOrEqual(1);
    expect(body.data.expensesNeedReview).toBeGreaterThanOrEqual(1);
    expect(body.data.sinceAt).toBeTruthy();
  });

  test('2. GET /catch-up with no `since` defaults to 24h ago', async ({ request }) => {
    const res = await request.get(`${WEB}/api/v1/agentbook-core/catch-up`, {
      headers: { 'x-tenant-id': TENANT_A },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.sinceAt).toBeTruthy();
    // sinceAt should be roughly 24h before now (within 60s slack).
    const since = new Date(body.data.sinceAt).getTime();
    const expected = Date.now() - 24 * 60 * 60 * 1000;
    expect(Math.abs(since - expected)).toBeLessThan(60_000);
  });

  test('3. Cross-tenant — tenant A summary excludes tenant B activity', async ({ request }) => {
    const resA = await request.get(`${WEB}/api/v1/agentbook-core/catch-up?since=${encodeURIComponent(sinceIso)}`, {
      headers: { 'x-tenant-id': TENANT_A },
    });
    const bodyA = await resA.json();
    // Tenant A's invoicesPaid total should NOT include the $9999.99 from B.
    expect(bodyA.data.invoicesPaid.totalCents).toBeLessThan(999_999);

    const resB = await request.get(`${WEB}/api/v1/agentbook-core/catch-up?since=${encodeURIComponent(sinceIso)}`, {
      headers: { 'x-tenant-id': TENANT_B },
    });
    const bodyB = await resB.json();
    // Tenant B sees its own row, not A's.
    expect(bodyB.data.invoicesPaid.count).toBeGreaterThanOrEqual(1);
    expect(bodyB.data.invoicesPaid.totalCents).toBe(999_999);
  });

  test('4. Bot intent — "catch me up" replies with the Catch-up header', async ({ request }) => {
    const resp = await postWebhook(request, 'catch me up');
    expect(resp.ok).toBeTruthy();
    const reply = (resp.captured || []).map((c) => c.text).join('\n');
    expect(reply).toMatch(/catch.up/i);
  });

  test('5. Invalid `since` doesn\'t 500 — falls back to 24h default', async ({ request }) => {
    const res = await request.get(`${WEB}/api/v1/agentbook-core/catch-up?since=not-a-date`, {
      headers: { 'x-tenant-id': TENANT_A },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.sinceAt).toBeTruthy();
  });
});
