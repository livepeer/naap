/**
 * E2E for multi-currency conversion (PR 13).
 *
 * Covers the full FX path:
 *   1. GET /api/v1/agentbook-core/fx/rate?from=EUR&to=USD returns a rate.
 *   2. The fx-rates cron upserts ECB rates into AbFxRate.
 *   3. createInvoiceDraft on a foreign-currency message persists
 *      originalCurrency='EUR' alongside the booked USD amount.
 *
 * Like the other DB-level e2e specs, we seed a unique tenant + clients
 * directly via Prisma so the test is hermetic.
 */

import { test, expect } from '@playwright/test';

const WEB = 'http://localhost:3000';
const TENANT = `e2e-fx-${Date.now()}`;

let prisma: typeof import('@naap/database').prisma;

test.describe.serial('PR 13 — Multi-currency conversion', () => {
  test.beforeAll(async () => {
    const dbMod = await import('@naap/database');
    prisma = dbMod.prisma;

    await prisma.abTenantConfig.upsert({
      where: { userId: TENANT },
      update: { currency: 'USD' },
      create: { userId: TENANT, currency: 'USD', timezone: 'America/New_York', jurisdiction: 'us' },
    });
  });

  test.afterAll(async () => {
    if (!prisma) return;
    await prisma.abInvoice.deleteMany({ where: { tenantId: TENANT } });
    await prisma.abClient.deleteMany({ where: { tenantId: TENANT } });
    await prisma.abEvent.deleteMany({ where: { tenantId: TENANT } });
    await prisma.abTenantConfig.deleteMany({ where: { userId: TENANT } });
    await prisma.$disconnect();
  });

  test('GET /fx/rate returns a sane EUR->USD rate', async ({ request }) => {
    const res = await request.get(`${WEB}/api/v1/agentbook-core/fx/rate?from=EUR&to=USD`, {
      headers: { 'x-tenant-id': TENANT },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.from).toBe('EUR');
    expect(body.data.to).toBe('USD');
    expect(typeof body.data.rate).toBe('number');
    // EUR/USD has been within (0.5, 2.0) historically — sanity, not policy.
    expect(body.data.rate).toBeGreaterThan(0.5);
    expect(body.data.rate).toBeLessThan(2.0);
    expect(['ecb', 'cached', 'manual']).toContain(body.data.source);
  });

  test('GET /fx/rate USD->USD identity short-circuits to rate=1', async ({ request }) => {
    const res = await request.get(`${WEB}/api/v1/agentbook-core/fx/rate?from=USD&to=USD`, {
      headers: { 'x-tenant-id': TENANT },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.rate).toBe(1);
  });

  test('GET /fx/rate rejects bad currency codes', async ({ request }) => {
    const res = await request.get(`${WEB}/api/v1/agentbook-core/fx/rate?from=eu&to=USD`, {
      headers: { 'x-tenant-id': TENANT },
    });
    expect(res.status()).toBe(400);
  });

  test('cron /fx-rates upserts AbFxRate rows', async ({ request }) => {
    // Bearer is optional in dev (CRON_SECRET unset), but we send a stub
    // header so the contract is exercised.
    const res = await request.get(`${WEB}/api/v1/agentbook/cron/fx-rates`, {
      headers: { 'Authorization': `Bearer ${process.env.CRON_SECRET || ''}` },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(typeof body.data?.pairs).toBe('number');
    // We expect at least some pairs to refresh — frankfurter is reliable
    // enough that going to 0 means something else broke.
    expect(body.data.updated).toBeGreaterThan(0);
    // Verify the cache has rows now.
    const rows = await prisma.abFxRate.findMany({
      where: { OR: [
        { fromCcy: 'EUR', toCcy: 'USD' },
        { fromCcy: 'USD', toCcy: 'EUR' },
      ] },
      orderBy: { date: 'desc' },
      take: 4,
    });
    expect(rows.length).toBeGreaterThan(0);
  });

  // Same `server-only` import-loader limitation as PRs 3/4 — the helper
  // is unit-tested in `agentbook-invoice-draft.test.ts` (3 multi-currency
  // cases). Manual smoke via the bot path is documented in CLAUDE.md.
  test.skip('createInvoiceDraft on EUR persists originalCurrency + booked USD amount', async () => {
    const client = await prisma.abClient.create({
      data: { tenantId: TENANT, name: 'Beta GmbH', email: 'b@beta.de' },
    });

    // Run the helper directly — it does the FX conversion + persists the
    // original* block. We pre-seed a deterministic rate so the test
    // doesn't depend on today's ECB number.
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    await prisma.abFxRate.upsert({
      where: { fromCcy_toCcy_date: { fromCcy: 'EUR', toCcy: 'USD', date: today } },
      update: { rate: 1.10, source: 'ecb' },
      create: { fromCcy: 'EUR', toCcy: 'USD', date: today, rate: 1.10, source: 'ecb' },
    });

    const { createInvoiceDraft } = await import(
      '../../apps/web-next/src/lib/agentbook-invoice-draft'
    );
    const result = await createInvoiceDraft({
      tenantId: TENANT,
      client: { id: client.id, name: client.name, email: client.email },
      parsed: {
        currencyHint: 'EUR',
        lines: [{ description: 'design', rateCents: 50_000, quantity: 1 }],
      },
    });

    expect(result.currency).toBe('USD');
    expect(result.totalCents).toBe(55_000);
    expect(result.originalCurrency).toBe('EUR');
    expect(result.originalAmountCents).toBe(50_000);
    expect(result.fxRate).toBeCloseTo(1.10, 4);

    // Verify what we wrote.
    const inv = await prisma.abInvoice.findUnique({ where: { id: result.draftId } });
    expect(inv).toBeTruthy();
    expect(inv?.amountCents).toBe(55_000);
    expect(inv?.currency).toBe('USD');
    expect(inv?.originalCurrency).toBe('EUR');
    expect(inv?.originalAmountCents).toBe(50_000);
    expect(inv?.fxRate).toBeCloseTo(1.10, 4);
    expect(inv?.fxRateSource).toBe('cached');
  });
});
