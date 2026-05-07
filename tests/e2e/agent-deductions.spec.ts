/**
 * E2E for smart deduction discovery (PR 12).
 *
 * Coverage:
 *   1. Run discovery directly: meals + same-week client invoice
 *      → meal_with_client_invoice rule fires + writes a row.
 *   2. POST /deductions/suggestions/[id]/apply — flips the suggestion
 *      to 'applied' AND sets the underlying expense's isDeductible
 *      and taxCategory.
 *   3. POST /deductions/suggestions/[id]/dismiss — sets status to
 *      'dismissed' with expiresAt ≈ +90d.
 *   4. Cross-tenant: applying a sibling tenant's suggestion → 404.
 */

import { test, expect } from '@playwright/test';

const WEB = 'http://localhost:3000';
const TENANT_A = `e2e-dd-a-${Date.now()}`;
const TENANT_B = `e2e-dd-b-${Date.now()}`;

let prisma: typeof import('@naap/database').prisma;

test.describe.serial('PR 12 — Smart deduction discovery', () => {
  let mealsAccountId = '';
  let suggestionId = '';
  let mealExpenseId = '';
  let bSuggestionId = '';

  test.beforeAll(async () => {
    const dbMod = await import('@naap/database');
    prisma = dbMod.prisma;

    // Tenant A — chart of accounts + meals expense + same-week invoice.
    const meals = await prisma.abAccount.create({
      data: {
        tenantId: TENANT_A,
        code: '6400',
        name: 'Meals',
        accountType: 'expense',
        taxCategory: 'Line 24b',
      },
    });
    mealsAccountId = meals.id;

    // Pin both inside a single ISO week (Mon 2026-04-27 / Tue 2026-04-28).
    const monday = new Date('2026-04-27T12:00:00Z');
    const tuesday = new Date('2026-04-28T19:00:00Z');

    const meal = await prisma.abExpense.create({
      data: {
        tenantId: TENANT_A,
        amountCents: 5500,
        date: tuesday,
        description: 'Lunch — TechCorp pitch',
        categoryId: meals.id,
        status: 'confirmed',
        paymentMethod: 'credit_card',
        currency: 'USD',
        isPersonal: false,
        isDeductible: false,
      },
    });
    mealExpenseId = meal.id;

    const client = await prisma.abClient.create({
      data: { tenantId: TENANT_A, name: 'TechCorp', defaultTerms: 'net-30' },
    });
    await prisma.abInvoice.create({
      data: {
        tenantId: TENANT_A,
        clientId: client.id,
        number: `INV-DD-A-${Date.now()}`,
        amountCents: 250000,
        currency: 'USD',
        issuedDate: monday,
        dueDate: new Date(monday.getTime() + 30 * 86_400_000),
        status: 'sent',
      },
    });

    // Tenant B — its own seed pair so its discovery run produces a
    // suggestion we can use for the cross-tenant 404 case.
    const bMeals = await prisma.abAccount.create({
      data: {
        tenantId: TENANT_B,
        code: '6400',
        name: 'Meals',
        accountType: 'expense',
        taxCategory: 'Line 24b',
      },
    });
    await prisma.abExpense.create({
      data: {
        tenantId: TENANT_B,
        amountCents: 4200,
        date: tuesday,
        description: 'Coffee with prospect',
        categoryId: bMeals.id,
        status: 'confirmed',
        paymentMethod: 'credit_card',
        currency: 'USD',
        isPersonal: false,
        isDeductible: false,
      },
    });
    const bClient = await prisma.abClient.create({
      data: { tenantId: TENANT_B, name: 'BetaCo', defaultTerms: 'net-30' },
    });
    await prisma.abInvoice.create({
      data: {
        tenantId: TENANT_B,
        clientId: bClient.id,
        number: `INV-DD-B-${Date.now()}`,
        amountCents: 100000,
        currency: 'USD',
        issuedDate: monday,
        dueDate: new Date(monday.getTime() + 30 * 86_400_000),
        status: 'sent',
      },
    });
  });

  test.afterAll(async () => {
    if (!prisma) return;
    await prisma.abDeductionSuggestion.deleteMany({
      where: { tenantId: { in: [TENANT_A, TENANT_B] } },
    });
    await prisma.abAuditEvent.deleteMany({
      where: { tenantId: { in: [TENANT_A, TENANT_B] } },
    });
    await prisma.abInvoice.deleteMany({ where: { tenantId: { in: [TENANT_A, TENANT_B] } } });
    await prisma.abClient.deleteMany({ where: { tenantId: { in: [TENANT_A, TENANT_B] } } });
    await prisma.abExpense.deleteMany({ where: { tenantId: { in: [TENANT_A, TENANT_B] } } });
    await prisma.abAccount.deleteMany({ where: { tenantId: { in: [TENANT_A, TENANT_B] } } });
    await prisma.$disconnect();
  });

  test('cron route runs the rules engine; meals + same-week invoice → high-confidence suggestion', async ({ request }) => {
    // The cron is bearer-gated when CRON_SECRET is set. Send the matching
    // Authorization header conditionally so the test works both locally
    // (with CRON_SECRET set) and in environments where it's unset.
    const cronSecret = process.env.CRON_SECRET || '';
    const headers: Record<string, string> = cronSecret
      ? { Authorization: `Bearer ${cronSecret}` }
      : {};
    const res = await request.get(
      `${WEB}/api/v1/agentbook/cron/deduction-discovery`,
      { headers },
    );
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.ok).toBe(true);

    const aRows = await prisma.abDeductionSuggestion.findMany({
      where: { tenantId: TENANT_A, status: 'open' },
    });
    expect(aRows.length).toBeGreaterThanOrEqual(1);
    const ruleHit = aRows.find((r) => r.ruleId === 'meal_with_client_invoice');
    expect(ruleHit).toBeDefined();
    expect(ruleHit!.confidence).toBeGreaterThanOrEqual(0.7);
    expect(ruleHit!.expenseId).toBe(mealExpenseId);
    suggestionId = ruleHit!.id;

    // Tenant-B suggestion id used by the cross-tenant test below.
    const bRows = await prisma.abDeductionSuggestion.findMany({
      where: { tenantId: TENANT_B, status: 'open' },
    });
    expect(bRows.length).toBeGreaterThanOrEqual(1);
    bSuggestionId = bRows[0].id;
  });

  test('apply endpoint flips suggestion to applied + expense to deductible', async ({ request }) => {
    const res = await request.post(
      `${WEB}/api/v1/agentbook-expense/deductions/suggestions/${suggestionId}/apply`,
      {
        headers: { 'Content-Type': 'application/json', 'x-tenant-id': TENANT_A },
      },
    );
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.status).toBe('applied');

    const refreshed = await prisma.abDeductionSuggestion.findUnique({ where: { id: suggestionId } });
    expect(refreshed?.status).toBe('applied');

    const expense = await prisma.abExpense.findUnique({ where: { id: mealExpenseId } });
    expect(expense?.isDeductible).toBe(true);
    expect(expense?.taxCategory).toBe('Line 24b');

    // Audit row exists for both writes.
    const audit = await prisma.abAuditEvent.findMany({
      where: { tenantId: TENANT_A, entityId: { in: [suggestionId, mealExpenseId] } },
    });
    expect(audit.length).toBeGreaterThanOrEqual(2);
    expect(audit.some((a) => a.action === 'deduction.apply')).toBe(true);
    expect(audit.some((a) => a.action === 'expense.mark_deductible')).toBe(true);
  });

  test('dismiss endpoint sets status=dismissed and expiresAt ≈ now+90d', async ({ request }) => {
    // Need a fresh OPEN suggestion (the previous test applied the only one).
    // Add a second meal expense on a different week so the dedupe key
    // differs from the applied row, then re-run discovery via the cron.
    const wednesday = new Date('2026-04-29T20:00:00Z');
    const meal2 = await prisma.abExpense.create({
      data: {
        tenantId: TENANT_A,
        amountCents: 6800,
        date: wednesday,
        description: 'Dinner — TechCorp follow-up',
        categoryId: mealsAccountId,
        status: 'confirmed',
        paymentMethod: 'credit_card',
        currency: 'USD',
        isPersonal: false,
        isDeductible: false,
      },
    });
    const cronAuthHeaders: Record<string, string> = process.env.CRON_SECRET
      ? { Authorization: `Bearer ${process.env.CRON_SECRET}` }
      : {};
    const cronRes = await request.get(`${WEB}/api/v1/agentbook/cron/deduction-discovery`, { headers: cronAuthHeaders });
    expect(cronRes.ok()).toBeTruthy();
    const fresh = await prisma.abDeductionSuggestion.findFirst({
      where: { tenantId: TENANT_A, status: 'open', expenseId: meal2.id },
    });
    expect(fresh).toBeDefined();

    const res = await request.post(
      `${WEB}/api/v1/agentbook-expense/deductions/suggestions/${fresh!.id}/dismiss`,
      {
        headers: { 'Content-Type': 'application/json', 'x-tenant-id': TENANT_A },
      },
    );
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.data.status).toBe('dismissed');

    const refreshed = await prisma.abDeductionSuggestion.findUnique({ where: { id: fresh!.id } });
    expect(refreshed?.status).toBe('dismissed');
    expect(refreshed?.expiresAt).toBeDefined();
    const daysAhead =
      ((refreshed!.expiresAt!.getTime() - Date.now()) / 86_400_000);
    expect(daysAhead).toBeGreaterThan(85);
    expect(daysAhead).toBeLessThan(95);
  });

  test('cross-tenant apply on TENANT_B suggestion via TENANT_A header → 404', async ({ request }) => {
    const res = await request.post(
      `${WEB}/api/v1/agentbook-expense/deductions/suggestions/${bSuggestionId}/apply`,
      {
        headers: { 'Content-Type': 'application/json', 'x-tenant-id': TENANT_A },
      },
    );
    expect(res.status()).toBe(404);
  });
});
