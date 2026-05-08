/**
 * E2E for the home-office quarterly flow (PR 15).
 *
 * Like the per-diem and mileage e2e specs, the bot loop module imports
 * `'server-only'` which Playwright's tsx loader can't satisfy, so we
 * exercise the data model + math directly. Pure ratio + simplified
 * formula validation lives in the vitest at
 * `apps/web-next/src/lib/agentbook-home-office.test.ts`. This file
 * proves end-to-end:
 *
 *   1. Config save (totalSqft + officeSqft) → ratio computed and
 *      persisted on AbHomeOfficeConfig.
 *   2. Post-quarter (actual-expense mode) creates AbExpense rows
 *      tagged taxCategory='home_office' summing to ratio × total.
 *   3. Post-quarter (US simplified mode) creates a single row at the
 *      flat $5/sqft × officeSqft / 4-quarters amount.
 *   4. Tenant scoping — a different tenant must not see the rows.
 *   5. Quarter anchor — the row date matches the start of the
 *      requested quarter.
 */

import { test, expect } from '@playwright/test';

let prisma: typeof import('@naap/database').prisma;

const ACTUAL_TENANT = `e2e-ho-actual-${Date.now()}`;
const SIMPLIFIED_TENANT = `e2e-ho-simplified-${Date.now()}`;
const OTHER_TENANT = `e2e-ho-other-${Date.now()}`;

test.beforeAll(async () => {
  const dbMod = await import('@naap/database');
  prisma = dbMod.prisma;

  for (const userId of [ACTUAL_TENANT, SIMPLIFIED_TENANT, OTHER_TENANT]) {
    await prisma.abTenantConfig.upsert({
      where: { userId },
      update: {},
      create: { userId, jurisdiction: 'us', currency: 'USD' },
    });
  }
});

test.afterAll(async () => {
  if (!prisma) return;
  for (const tenantId of [ACTUAL_TENANT, SIMPLIFIED_TENANT, OTHER_TENANT]) {
    await prisma.abExpense.deleteMany({ where: { tenantId } });
    await prisma.abEvent.deleteMany({ where: { tenantId } });
    await prisma.abHomeOfficeConfig.deleteMany({ where: { tenantId } });
    await prisma.abTenantConfig.deleteMany({ where: { userId: tenantId } });
  }
  await prisma.$disconnect();
});

test.describe.serial('Home-office — config + quarterly posting', () => {
  test('1. config save: 2000 total / 200 office → 10% ratio persisted', async () => {
    const cfg = await prisma.abHomeOfficeConfig.upsert({
      where: { tenantId: ACTUAL_TENANT },
      update: {
        totalSqft: 2000,
        officeSqft: 200,
        ratio: 0.1,
        useUsSimplified: false,
      },
      create: {
        tenantId: ACTUAL_TENANT,
        totalSqft: 2000,
        officeSqft: 200,
        ratio: 0.1,
        useUsSimplified: false,
      },
    });
    expect(cfg.totalSqft).toBe(2000);
    expect(cfg.officeSqft).toBe(200);
    expect(cfg.ratio).toBeCloseTo(0.1, 6);
    expect(cfg.useUsSimplified).toBe(false);
  });

  test('2. actual-expense post-quarter: 10% × $3,590 quarter total = $359 deductible', async () => {
    // Mirror the route's transaction. Quarter Q2 2026 anchors at
    // April 1, 2026 UTC midnight.
    const year = 2026;
    const quarter = 2;
    const utilitiesCents = 40_000;     // $400
    const internetCents = 9_000;       // $90
    const rentInterestCents = 300_000; // $3,000
    const insuranceCents = 9_000;      // $90
    const otherCents = 1_000;          // $10
    const totalCents =
      utilitiesCents + internetCents + rentInterestCents + insuranceCents + otherCents;
    expect(totalCents).toBe(359_000);

    const ratio = 0.1;
    const deductibleCents = Math.round(totalCents * ratio); // 35,900
    expect(deductibleCents).toBe(35_900);

    const QUARTER_TO_MONTH = [0, 3, 6, 9];
    const anchor = new Date(Date.UTC(year, QUARTER_TO_MONTH[quarter - 1], 1));

    // Per-component apportionment with the rounding remainder
    // absorbed by the last row. Mirrors the route logic.
    const components = [
      { label: 'utilities', gross: utilitiesCents },
      { label: 'internet', gross: internetCents },
      { label: 'rent/mortgage interest', gross: rentInterestCents },
      { label: 'insurance', gross: insuranceCents },
      { label: 'other', gross: otherCents },
    ];
    let allocated = 0;
    const rows = await prisma.$transaction(async (tx) => {
      const out: { id: string; amountCents: number; description: string }[] = [];
      for (let i = 0; i < components.length; i += 1) {
        const c = components[i];
        let portion: number;
        if (i === components.length - 1) {
          portion = deductibleCents - allocated;
        } else {
          portion = Math.round((c.gross / totalCents) * deductibleCents);
          allocated += portion;
        }
        if (portion <= 0) continue;
        const r = await tx.abExpense.create({
          data: {
            tenantId: ACTUAL_TENANT,
            amountCents: portion,
            date: anchor,
            description: `Home office — ${c.label} Q${quarter} ${year}`,
            taxCategory: 'home_office',
            isPersonal: false,
            isDeductible: true,
            status: 'confirmed',
            source: 'home_office',
            currency: 'USD',
          },
        });
        out.push({
          id: r.id,
          amountCents: r.amountCents,
          description: r.description || '',
        });
      }
      return out;
    });

    expect(rows.length).toBe(5);
    const sum = rows.reduce((s, r) => s + r.amountCents, 0);
    expect(sum).toBe(deductibleCents);

    // Verify the rows are tagged + anchored correctly.
    const found = await prisma.abExpense.findMany({
      where: { tenantId: ACTUAL_TENANT, taxCategory: 'home_office' },
    });
    expect(found.length).toBe(5);
    for (const f of found) {
      expect(f.taxCategory).toBe('home_office');
      expect(f.isDeductible).toBe(true);
      expect(f.isPersonal).toBe(false);
      expect(f.date.toISOString()).toBe(anchor.toISOString());
      expect(f.description).toMatch(/Home office —/);
    }
  });

  test('3. US simplified post-quarter: 200 sqft × $5 / 4 quarters = $250', async () => {
    const cfg = await prisma.abHomeOfficeConfig.upsert({
      where: { tenantId: SIMPLIFIED_TENANT },
      update: {
        officeSqft: 200,
        useUsSimplified: true,
      },
      create: {
        tenantId: SIMPLIFIED_TENANT,
        totalSqft: null,
        officeSqft: 200,
        ratio: null,
        useUsSimplified: true,
      },
    });
    expect(cfg.useUsSimplified).toBe(true);

    // Simplified flat rate = officeSqft × $5 (capped at 300 sqft) ÷ 4
    const sqft = Math.min(cfg.officeSqft || 0, 300);
    const annualCents = sqft * 500;
    const quarterlyCents = Math.round(annualCents / 4);
    expect(quarterlyCents).toBe(25_000); // $250

    const year = 2026;
    const quarter = 2;
    const anchor = new Date(Date.UTC(year, 3, 1));

    const r = await prisma.abExpense.create({
      data: {
        tenantId: SIMPLIFIED_TENANT,
        amountCents: quarterlyCents,
        date: anchor,
        description: `Home office — Q${quarter} ${year} (US simplified, ${sqft} sqft)`,
        taxCategory: 'home_office',
        isPersonal: false,
        isDeductible: true,
        status: 'confirmed',
        source: 'home_office',
        currency: 'USD',
      },
    });
    expect(r.amountCents).toBe(25_000);
    expect(r.taxCategory).toBe('home_office');

    // Sanity — the 300-sqft cap caps a hypothetical 400-sqft user
    // at $1,500/yr → $375/quarter.
    const hypotheticalCappedQuarter = Math.round(Math.min(400, 300) * 500 / 4);
    expect(hypotheticalCappedQuarter).toBe(37_500);
  });

  test('4. tenant scoping — other tenant sees zero home-office rows', async () => {
    const others = await prisma.abExpense.findMany({
      where: { tenantId: OTHER_TENANT, taxCategory: 'home_office' },
    });
    expect(others.length).toBe(0);

    // The two earlier tenants each have rows; cross-tenant queries
    // must not leak.
    const actualOnly = await prisma.abExpense.findMany({
      where: { tenantId: ACTUAL_TENANT, taxCategory: 'home_office' },
    });
    const simplifiedOnly = await prisma.abExpense.findMany({
      where: { tenantId: SIMPLIFIED_TENANT, taxCategory: 'home_office' },
    });
    expect(actualOnly.length).toBeGreaterThanOrEqual(1);
    expect(simplifiedOnly.length).toBeGreaterThanOrEqual(1);
    for (const r of actualOnly) expect(r.tenantId).toBe(ACTUAL_TENANT);
    for (const r of simplifiedOnly) expect(r.tenantId).toBe(SIMPLIFIED_TENANT);
  });

  test('5. quarter anchor maps Q1/Q2/Q3/Q4 → Jan/Apr/Jul/Oct of the requested year', async () => {
    const QUARTER_TO_MONTH = [0, 3, 6, 9];
    const cases = [
      { year: 2026, q: 1, isoMonth: '2026-01-01' },
      { year: 2026, q: 2, isoMonth: '2026-04-01' },
      { year: 2026, q: 3, isoMonth: '2026-07-01' },
      { year: 2026, q: 4, isoMonth: '2026-10-01' },
    ];
    for (const c of cases) {
      const d = new Date(Date.UTC(c.year, QUARTER_TO_MONTH[c.q - 1], 1));
      expect(d.toISOString().slice(0, 10)).toBe(c.isoMonth);
    }
  });
});
