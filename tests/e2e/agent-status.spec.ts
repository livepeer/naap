/**
 * E2E for /status (PR 22).
 *
 * Coverage:
 *   1. GET /status returns a tenant-scoped snapshot with the right
 *      shape (bot, database, bankSync, morningDigest, cpaRequests,
 *      recentErrors).
 *   2. Cross-tenant — sibling tenant's CPA request / bank account does
 *      NOT appear in tenant A's snapshot.
 *   3. Bot intent — POST telegram webhook with "/status" → reply
 *      contains the "Status" header.
 *   4. Sanitised response — even with no fixtures, the endpoint
 *      returns success=true with sane defaults (does not 500).
 */

import { test, expect } from '@playwright/test';

const WEB = 'http://localhost:3000';
const TENANT_A = `e2e-status-a-${Date.now()}`;
const TENANT_B = `e2e-status-b-${Date.now()}`;
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

test.describe.serial('PR 22 — /status', () => {
  test.beforeAll(async () => {
    const dbMod = await import('@naap/database');
    prisma = dbMod.prisma;

    // Tenant A: 1 connected bank account, 1 open CPA request.
    await prisma.abBankAccount.create({
      data: {
        tenantId: TENANT_A,
        name: 'Status Bank A',
        type: 'checking',
        connected: true,
        lastSynced: new Date(Date.now() - 2 * 60 * 60 * 1000),
      },
    });
    await prisma.abAccountantRequest.create({
      data: {
        tenantId: TENANT_A,
        accessId: 'fake-access-a',
        entityType: 'general',
        message: 'A status-test CPA question',
        status: 'open',
      },
    });

    // Tenant B: a single open CPA request that must NOT leak into A.
    await prisma.abAccountantRequest.create({
      data: {
        tenantId: TENANT_B,
        accessId: 'fake-access-b',
        entityType: 'general',
        message: 'B status-test CPA question',
        status: 'open',
      },
    });
  });

  test.afterAll(async () => {
    for (const tenantId of [TENANT_A, TENANT_B]) {
      await prisma.abAccountantRequest.deleteMany({ where: { tenantId } });
      await prisma.abBankAccount.deleteMany({ where: { tenantId } });
    }
  });

  test('1. GET /status returns a snapshot for tenant A with right shape', async ({ request }) => {
    const res = await request.get(`${WEB}/api/v1/agentbook-core/status`, {
      headers: { 'x-tenant-id': TENANT_A },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.bot.ok).toBe(true);
    expect(typeof body.data.database.ok).toBe('boolean');
    expect(typeof body.data.database.latencyMs).toBe('number');
    expect(body.data.bankSync.connectedAccounts).toBeGreaterThanOrEqual(1);
    expect(body.data.cpaRequests.open).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(body.data.recentErrors)).toBe(true);
  });

  test('2. Cross-tenant — tenant A snapshot does not see tenant B CPA requests', async ({ request }) => {
    const resA = await request.get(`${WEB}/api/v1/agentbook-core/status`, {
      headers: { 'x-tenant-id': TENANT_A },
    });
    const bodyA = await resA.json();
    const resB = await request.get(`${WEB}/api/v1/agentbook-core/status`, {
      headers: { 'x-tenant-id': TENANT_B },
    });
    const bodyB = await resB.json();
    // Both report ≥1 open request, but neither's count includes the
    // *other's* row. We can only verify by counting fixtures: A has 1,
    // B has 1 — neither should jump to 2.
    expect(bodyA.data.cpaRequests.open).toBe(1);
    expect(bodyB.data.cpaRequests.open).toBe(1);
    // Tenant B has no bank accounts seeded; A has 1.
    expect(bodyA.data.bankSync.connectedAccounts).toBe(1);
    expect(bodyB.data.bankSync.connectedAccounts).toBe(0);
  });

  test('3. Bot intent — "/status" replies with the Status header', async ({ request }) => {
    const resp = await postWebhook(request, '/status');
    expect(resp.ok).toBeTruthy();
    const reply = (resp.captured || []).map((c) => c.text).join('\n');
    expect(reply).toMatch(/status/i);
  });

  test('4. Empty tenant returns success=true with sensible defaults', async ({ request }) => {
    const emptyTenant = `e2e-status-empty-${Date.now()}`;
    const res = await request.get(`${WEB}/api/v1/agentbook-core/status`, {
      headers: { 'x-tenant-id': emptyTenant },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.bankSync).toEqual({ lastSyncedAt: null, connectedAccounts: 0 });
    expect(body.data.morningDigest).toEqual({ lastSentAt: null });
    expect(body.data.cpaRequests).toEqual({ open: 0 });
    expect(body.data.recentErrors).toEqual([]);
  });
});
