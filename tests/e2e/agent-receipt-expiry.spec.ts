/**
 * E2E for receipt-expiry warnings (PR 16).
 *
 * Coverage:
 *   1. Morning-digest "missing receipts" section appears when business-
 *      deductible expenses older than 14 days have no receiptUrl, and the
 *      count matches.
 *   2. POST /agentbook-expense/expenses/[id]/skip-receipt flips the row's
 *      receiptStatus to 'skipped' and removes it from the digest query.
 *   3. Cross-tenant — sibling tenant cannot skip another tenant's receipt.
 */

import { test, expect } from '@playwright/test';

const WEB = 'http://localhost:3000';
const TENANT_A = `e2e-rcpt-a-${Date.now()}`;
const TENANT_B = `e2e-rcpt-b-${Date.now()}`;

let prisma: typeof import('@naap/database').prisma;

test.describe.serial('PR 16 — Receipt-expiry warnings', () => {
  let oldExpenseId = '';   // 20-d old, deductible, no receipt → in digest
  let oldExpenseId2 = '';  // 21-d old, taxCategory set, no receipt → also in digest
  let recentExpenseId = ''; // 5-d old, deductible, no receipt → NOT in digest
  let attachedExpenseId = ''; // 30-d old but receiptUrl set → NOT in digest
  let personalExpenseId = ''; // 30-d old, isPersonal=true → NOT in digest

  test.beforeAll(async () => {
    const dbMod = await import('@naap/database');
    prisma = dbMod.prisma;

    const now = Date.now();
    const day = 86_400_000;

    // Tenant A — 5 expenses spanning the full filter matrix.
    const old1 = await prisma.abExpense.create({
      data: {
        tenantId: TENANT_A,
        amountCents: 12_99,
        date: new Date(now - 20 * day),
        description: 'AWS October bill',
        isPersonal: false,
        isDeductible: true,
        status: 'confirmed',
        currency: 'USD',
      },
    });
    oldExpenseId = old1.id;

    const old2 = await prisma.abExpense.create({
      data: {
        tenantId: TENANT_A,
        amountCents: 89_00,
        date: new Date(now - 21 * day),
        description: 'GitHub annual',
        taxCategory: 'Line 22',  // deductible by virtue of taxCategory set
        isPersonal: false,
        isDeductible: false,
        status: 'confirmed',
        currency: 'USD',
      },
    });
    oldExpenseId2 = old2.id;

    const recent = await prisma.abExpense.create({
      data: {
        tenantId: TENANT_A,
        amountCents: 45_00,
        date: new Date(now - 5 * day),  // < 14 days, excluded
        description: 'Lunch — recent',
        isPersonal: false,
        isDeductible: true,
        status: 'confirmed',
        currency: 'USD',
      },
    });
    recentExpenseId = recent.id;

    const attached = await prisma.abExpense.create({
      data: {
        tenantId: TENANT_A,
        amountCents: 199_00,
        date: new Date(now - 30 * day),
        description: 'Conference fee',
        isPersonal: false,
        isDeductible: true,
        receiptUrl: 'https://example.com/r.pdf', // already attached, excluded
        status: 'confirmed',
        currency: 'USD',
      },
    });
    attachedExpenseId = attached.id;

    const personal = await prisma.abExpense.create({
      data: {
        tenantId: TENANT_A,
        amountCents: 25_00,
        date: new Date(now - 30 * day),
        description: 'Personal lunch',
        isPersonal: true, // excluded
        isDeductible: false,
        status: 'confirmed',
        currency: 'USD',
      },
    });
    personalExpenseId = personal.id;

    // Tenant B — one row of its own, used to prove tenant scoping.
    await prisma.abExpense.create({
      data: {
        tenantId: TENANT_B,
        amountCents: 50_00,
        date: new Date(now - 30 * day),
        description: 'B tenant aged expense',
        isPersonal: false,
        isDeductible: true,
        status: 'confirmed',
        currency: 'USD',
      },
    });
  });

  test.afterAll(async () => {
    if (!prisma) return;
    for (const tenantId of [TENANT_A, TENANT_B]) {
      await prisma.abExpense.deleteMany({ where: { tenantId } });
      await prisma.abEvent.deleteMany({ where: { tenantId } });
      await prisma.abAuditEvent.deleteMany({ where: { tenantId } });
    }
    await prisma.$disconnect();
  });

  test('1. digest query returns only the 2 aged business+deductible rows', async () => {
    // Mirror the morning-digest query shape exactly.
    const fourteenDaysAgo = new Date(Date.now() - 14 * 86_400_000);
    const rows = await prisma.abExpense.findMany({
      where: {
        tenantId: TENANT_A,
        isPersonal: false,
        receiptUrl: null,
        OR: [
          { isDeductible: true },
          { taxCategory: { not: null } },
        ],
        AND: [
          {
            OR: [
              { receiptStatus: 'pending' },
              { receiptStatus: null },
            ],
          },
        ],
        date: { lt: fourteenDaysAgo },
      },
    });

    const ids = rows.map((r) => r.id).sort();
    expect(ids).toEqual([oldExpenseId, oldExpenseId2].sort());
    // Exclusions:
    expect(ids).not.toContain(recentExpenseId);   // < 14 days
    expect(ids).not.toContain(attachedExpenseId); // receiptUrl set
    expect(ids).not.toContain(personalExpenseId); // isPersonal
  });

  test('2. skip-receipt endpoint flips status and removes the row from the digest', async () => {
    const res = await fetch(`${WEB}/api/v1/agentbook-expense/expenses/${oldExpenseId}/skip-receipt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-tenant-id': TENANT_A },
    });
    expect(res.ok).toBe(true);
    const body = await res.json() as { success: boolean; data?: { receiptStatus: string } };
    expect(body.success).toBe(true);
    expect(body.data?.receiptStatus).toBe('skipped');

    // Verify the row is now excluded from the digest query.
    const fourteenDaysAgo = new Date(Date.now() - 14 * 86_400_000);
    const rows = await prisma.abExpense.findMany({
      where: {
        tenantId: TENANT_A,
        isPersonal: false,
        receiptUrl: null,
        OR: [
          { isDeductible: true },
          { taxCategory: { not: null } },
        ],
        AND: [
          {
            OR: [
              { receiptStatus: 'pending' },
              { receiptStatus: null },
            ],
          },
        ],
        date: { lt: fourteenDaysAgo },
      },
    });
    const ids = rows.map((r) => r.id);
    expect(ids).not.toContain(oldExpenseId);
    // The other aged row (taxCategory-driven) is still present.
    expect(ids).toContain(oldExpenseId2);
  });

  test('3. skip-receipt is idempotent — re-skipping returns success', async () => {
    const res = await fetch(`${WEB}/api/v1/agentbook-expense/expenses/${oldExpenseId}/skip-receipt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-tenant-id': TENANT_A },
    });
    expect(res.ok).toBe(true);
    const body = await res.json() as { success: boolean; data?: { receiptStatus: string } };
    expect(body.success).toBe(true);
    expect(body.data?.receiptStatus).toBe('skipped');
  });

  test('4. cross-tenant — sibling tenant cannot skip another tenant\'s receipt', async () => {
    const res = await fetch(`${WEB}/api/v1/agentbook-expense/expenses/${oldExpenseId2}/skip-receipt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-tenant-id': TENANT_B },
    });
    expect(res.status).toBe(404);
    const body = await res.json() as { success: boolean; error?: string };
    expect(body.success).toBe(false);

    // Tenant A's row stays untouched.
    const row = await prisma.abExpense.findUnique({ where: { id: oldExpenseId2 } });
    expect(row?.receiptStatus).not.toBe('skipped');
  });

  test('5. audit trail — skip-receipt writes an AbAuditEvent', async () => {
    // The skip in test #2 should have produced an audit row. Look for it.
    const audits = await prisma.abAuditEvent.findMany({
      where: {
        tenantId: TENANT_A,
        entityType: 'AbExpense',
        entityId: oldExpenseId,
        action: 'expense.receipt_skip',
      },
    });
    expect(audits.length).toBeGreaterThanOrEqual(1);
  });
});
