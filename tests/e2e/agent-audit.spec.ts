/**
 * E2E for the structured audit trail (PR 10).
 *
 * Coverage:
 *   1. POST /invoices/draft-from-text → AbAuditEvent w/ action='invoice.create'
 *      + entityId matches the new invoice + after.number / .amountCents present.
 *   2. PUT  /expenses/:id (edit)      → AbAuditEvent w/ action='expense.update',
 *      sparse before/after diff (only changed keys).
 *   3. DELETE /budgets/:id            → AbAuditEvent w/ action='budget.delete',
 *      before present, after null.
 *   4. GET  /audit-events?entityType=AbBudget → only budget rows back.
 *
 * The web layer + audit helper are best-effort — even on failure the
 * underlying mutation must succeed. We assert the mutation result
 * separately from the audit row in each case.
 */

import { test, expect } from '@playwright/test';

const WEB = 'http://localhost:3000';
const TENANT = `e2e-audit-${Date.now()}`;

let prisma: typeof import('@naap/database').prisma;

test.describe.serial('PR 10 — Audit trail', () => {
  test.beforeAll(async () => {
    const dbMod = await import('@naap/database');
    prisma = dbMod.prisma;

    // Minimal chart-of-accounts so invoice / expense create paths can post JEs.
    await prisma.abAccount.createMany({
      data: [
        { tenantId: TENANT, code: '1000', name: 'Cash', accountType: 'asset' },
        { tenantId: TENANT, code: '1100', name: 'Accounts Receivable', accountType: 'asset' },
        { tenantId: TENANT, code: '4000', name: 'Revenue', accountType: 'revenue' },
      ],
      skipDuplicates: true,
    });
  });

  test.afterAll(async () => {
    if (!prisma) return;
    // Clean up audit rows we created so re-runs stay deterministic.
    await prisma.abAuditEvent.deleteMany({ where: { tenantId: TENANT } });
    await prisma.$disconnect();
  });

  test('invoice.create via /draft-from-text writes a structured audit row', async ({ request }) => {
    // Seed a client so the parser's name match has somewhere to land.
    const client = await prisma.abClient.create({
      data: { tenantId: TENANT, name: 'AuditCo Industries', defaultTerms: 'net-30' },
    });

    const res = await request.post(`${WEB}/api/v1/agentbook-invoice/invoices/draft-from-text`, {
      data: { text: 'invoice AuditCo Industries $1,234 for May audit work' },
      headers: { 'Content-Type': 'application/json', 'x-tenant-id': TENANT },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.success).toBeTruthy();
    expect(body.data?.draftId).toBeTruthy();

    // Audit row should land within the request lifecycle (we await it
    // before the response). Re-read directly from the DB.
    const row = await prisma.abAuditEvent.findFirst({
      where: { tenantId: TENANT, entityId: body.data.draftId, action: 'invoice.create' },
    });
    expect(row).toBeTruthy();
    expect(row?.entityType).toBe('AbInvoice');
    expect(row?.before).toBeNull();
    expect(row?.after).toBeTruthy();
    const after = row?.after as Record<string, unknown>;
    expect(after.clientId).toBe(client.id);
    expect(after.number).toBeTruthy();
  });

  test('expense.update writes a sparse before/after diff (only changed keys)', async ({ request }) => {
    // Seed an expense directly, then PUT a partial edit through the route.
    const before = await prisma.abExpense.create({
      data: {
        tenantId: TENANT,
        amountCents: 1000,
        date: new Date(),
        description: 'Coffee with prospect',
        paymentMethod: 'card',
        currency: 'USD',
      },
    });

    const res = await request.put(`${WEB}/api/v1/agentbook-expense/expenses/${before.id}`, {
      data: { amountCents: 1500 }, // changed
      headers: { 'Content-Type': 'application/json', 'x-tenant-id': TENANT },
    });
    expect(res.ok()).toBeTruthy();

    const row = await prisma.abAuditEvent.findFirst({
      where: { tenantId: TENANT, entityId: before.id, action: 'expense.update' },
      orderBy: { createdAt: 'desc' },
    });
    expect(row).toBeTruthy();
    const beforeJson = row?.before as Record<string, unknown>;
    const afterJson = row?.after as Record<string, unknown>;
    // Only amountCents should be in the diff — description / date were untouched.
    expect(beforeJson).toEqual({ amountCents: 1000 });
    expect(afterJson).toEqual({ amountCents: 1500 });
  });

  test('budget.delete writes before, no after', async ({ request }) => {
    const budget = await prisma.abBudget.create({
      data: {
        tenantId: TENANT,
        amountCents: 50000,
        categoryName: 'Meals',
        period: 'monthly',
        alertPercent: 80,
      },
    });

    const res = await request.delete(`${WEB}/api/v1/agentbook-expense/budgets/${budget.id}`, {
      headers: { 'x-tenant-id': TENANT },
    });
    expect(res.ok()).toBeTruthy();

    const row = await prisma.abAuditEvent.findFirst({
      where: { tenantId: TENANT, entityId: budget.id, action: 'budget.delete' },
    });
    expect(row).toBeTruthy();
    expect(row?.entityType).toBe('AbBudget');
    expect(row?.after).toBeNull();
    const beforeJson = row?.before as Record<string, unknown>;
    expect(beforeJson.amountCents).toBe(50000);
    expect(beforeJson.categoryName).toBe('Meals');
  });

  test('GET /audit-events filters by entityType', async ({ request }) => {
    const res = await request.get(`${WEB}/api/v1/agentbook-core/audit-events?entityType=AbBudget`, {
      headers: { 'x-tenant-id': TENANT },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.success).toBeTruthy();
    // Every row coming back must be the requested entity type.
    for (const row of body.data) {
      expect(row.entityType).toBe('AbBudget');
      expect(row.tenantId).toBe(TENANT);
    }
    // We seeded one budget delete above — must be present.
    expect(body.data.length).toBeGreaterThanOrEqual(1);
  });
});
