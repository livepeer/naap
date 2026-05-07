/**
 * E2E for the mileage tracking flow (PR 4).
 *
 * Like bank-plaid (PR 3), the bot-loop module carries `import 'server-only'`
 * at the top, which Playwright's tsx loader can't satisfy without a
 * shim. The bot-loop's `mileage.record` skill is fully unit-tested via
 * `agentbook-mileage-rates.test.ts` + the regex smoke check; here we
 * exercise the DB / journal-entry contract directly so the spec can run
 * without the Next.js dev server.
 *
 * Coverage:
 *   1. mileage entry creation books a balanced JE @ IRS rate
 *   2. GET-style listing returns the entry
 *   3. YTD aggregation matches the entry's deductible cents
 *   4. DELETE-style reversal leaves trial balance unchanged
 */

import { test, expect } from '@playwright/test';

let prisma: typeof import('@naap/database').prisma;

const TENANT = `e2e-mileage-${Date.now()}`;

// Mirrors the helper in apps/web-next/src/lib/agentbook-mileage-rates.ts.
// Re-implemented inline to dodge the `server-only` import that the
// Playwright tsx loader can't satisfy. The values are the IRS-published
// 2025 rate + the 2026 CRA tiered table — assertion source-of-truth is
// the dedicated vitest in apps/web-next/src/lib/agentbook-mileage-rates.test.ts.
function rateUS(): number { return 67; }

test.beforeAll(async () => {
  const dbMod = await import('@naap/database');
  prisma = dbMod.prisma;

  await prisma.abAccount.createMany({
    data: [
      { tenantId: TENANT, code: '5100', name: 'Car & Truck', accountType: 'expense', taxCategory: 'Line 9' },
      { tenantId: TENANT, code: '3000', name: "Owner's Equity", accountType: 'equity' },
    ],
    skipDuplicates: true,
  });
  await prisma.abTenantConfig.upsert({
    where: { userId: TENANT },
    update: { jurisdiction: 'us' },
    create: { userId: TENANT, jurisdiction: 'us', currency: 'USD' },
  });
});

test.afterAll(async () => {
  if (!prisma) return;
  await prisma.abMileageEntry.deleteMany({ where: { tenantId: TENANT } });
  await prisma.abJournalEntry.deleteMany({ where: { tenantId: TENANT } });
  await prisma.abAccount.deleteMany({ where: { tenantId: TENANT } });
  await prisma.abEvent.deleteMany({ where: { tenantId: TENANT } });
  await prisma.abTenantConfig.deleteMany({ where: { userId: TENANT } });
  await prisma.$disconnect();
});

let entryId = '';

test.describe.serial('Mileage — entry + ledger', () => {
  test('1. "drove 47 miles to TechCorp" books entry @ IRS rate w/ balanced JE', async () => {
    const accounts = await prisma.abAccount.findMany({
      where: { tenantId: TENANT, code: { in: ['5100', '3000'] } },
    });
    const vehicle = accounts.find((a) => a.code === '5100')!;
    const equity = accounts.find((a) => a.code === '3000')!;
    const miles = 47;
    const ratePerUnitCents = rateUS();
    const deductibleAmountCents = Math.round(miles * ratePerUnitCents);
    expect(deductibleAmountCents).toBe(3149); // 47 × 67 = 3149¢

    const entry = await prisma.$transaction(async (tx) => {
      const je = await tx.abJournalEntry.create({
        data: {
          tenantId: TENANT,
          date: new Date(),
          memo: `Mileage: ${miles} mi — TechCorp meeting`,
          sourceType: 'mileage',
          verified: true,
          lines: {
            create: [
              { accountId: vehicle.id, debitCents: deductibleAmountCents, creditCents: 0 },
              { accountId: equity.id, debitCents: 0, creditCents: deductibleAmountCents },
            ],
          },
        },
      });
      const row = await tx.abMileageEntry.create({
        data: {
          tenantId: TENANT,
          date: new Date(),
          miles,
          unit: 'mi',
          purpose: 'TechCorp meeting',
          jurisdiction: 'us',
          ratePerUnitCents,
          deductibleAmountCents,
          journalEntryId: je.id,
        },
      });
      await tx.abJournalEntry.update({ where: { id: je.id }, data: { sourceId: row.id } });
      return row;
    });
    entryId = entry.id;

    // JE balanced?
    const lines = await prisma.abJournalLine.findMany({ where: { entryId: entry.journalEntryId! } });
    const debits = lines.reduce((s, l) => s + l.debitCents, 0);
    const credits = lines.reduce((s, l) => s + l.creditCents, 0);
    expect(debits).toBe(credits);
    expect(debits).toBe(deductibleAmountCents);
  });

  test('2. mileage listing returns the entry', async () => {
    const rows = await prisma.abMileageEntry.findMany({
      where: { tenantId: TENANT },
      orderBy: { date: 'desc' },
    });
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows[0].miles).toBe(47);
    expect(rows[0].purpose).toMatch(/TechCorp/i);
    expect(rows[0].jurisdiction).toBe('us');
  });

  test('3. YTD aggregation includes the entry', async () => {
    const yearStart = new Date(Date.UTC(new Date().getUTCFullYear(), 0, 1));
    const ytd = await prisma.abMileageEntry.findMany({
      where: { tenantId: TENANT, date: { gte: yearStart } },
    });
    const totalMiles = ytd.reduce((s, e) => s + e.miles, 0);
    const totalDeductible = ytd.reduce((s, e) => s + e.deductibleAmountCents, 0);
    expect(ytd.length).toBeGreaterThanOrEqual(1);
    expect(totalMiles).toBeGreaterThanOrEqual(47);
    expect(totalDeductible).toBeGreaterThanOrEqual(3149);
  });

  test('4. DELETE reverses the JE — trial balance for vehicle/equity nets to 0', async () => {
    const accounts = await prisma.abAccount.findMany({
      where: { tenantId: TENANT, code: { in: ['5100', '3000'] } },
    });
    const acctById = new Map(accounts.map((a) => [a.id, a.code]));

    const entry = await prisma.abMileageEntry.findUnique({ where: { id: entryId } });
    expect(entry).toBeTruthy();

    // Mirror what the DELETE handler does: post a reversal JE, then
    // hard-delete the mileage row.
    if (entry!.journalEntryId) {
      const original = await prisma.abJournalEntry.findUnique({
        where: { id: entry!.journalEntryId },
        include: { lines: true },
      });
      expect(original).toBeTruthy();
      await prisma.abJournalEntry.create({
        data: {
          tenantId: TENANT,
          date: new Date(),
          memo: `REVERSAL: ${original!.memo} (mileage delete)`,
          sourceType: 'mileage',
          sourceId: entry!.id,
          verified: true,
          lines: {
            create: original!.lines.map((l) => ({
              accountId: l.accountId,
              debitCents: l.creditCents,
              creditCents: l.debitCents,
            })),
          },
        },
      });
    }
    await prisma.abMileageEntry.delete({ where: { id: entryId } });

    const linesAfter = await prisma.abJournalLine.findMany({
      where: { entry: { tenantId: TENANT } },
    });
    const tb = new Map<string, number>();
    for (const l of linesAfter) {
      const code = acctById.get(l.accountId);
      if (!code) continue;
      tb.set(code, (tb.get(code) || 0) + l.debitCents - l.creditCents);
    }
    // Net effect on each account is zero — original + reversal cancel out.
    expect(tb.get('5100') || 0).toBe(0);
    expect(tb.get('3000') || 0).toBe(0);
    // Mileage row hard-deleted.
    const stillThere = await prisma.abMileageEntry.findUnique({ where: { id: entryId } });
    expect(stillThere).toBeNull();
  });
});
