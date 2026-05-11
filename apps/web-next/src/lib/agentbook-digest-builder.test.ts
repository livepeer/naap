import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import {
  buildHeader,
  buildHighlights,
  buildSnapshot,
  buildTodos,
  type DigestSummary,
} from './agentbook-digest-builder';

const TZ = 'America/New_York';

function makeSummary(overrides: Partial<DigestSummary> = {}): DigestSummary {
  return {
    snapshot: {
      cashTodayCents: 500000,
      cashYesterdayCents: 500000,
      arTotalCents: 0,
      arInvoiceCount: 0,
      mtdSpendCents: 0,
      mtdBudgetTotalCents: null,
    },
    yesterday: { paymentsInCents: 0, expensesOutCents: 0, netCents: 0, paymentCount: 0, expenseCount: 0 },
    pendingReviewCount: 0,
    attention: [],
    upcoming: [],
    anomalyCount: 0,
    taxDaysUntilQ: null,
    taxQEstimateCents: null,
    bankReview: { count: 0, items: [] },
    missingReceipts: { count: 0, items: [] },
    cpaRequests: [],
    deductions: [],
    hotBudgets: [],
    ai: { appliedCount: 0, pendingCount: 0 },
    ...overrides,
  };
}

describe('buildHeader', () => {
  it('renders date + 6:00am time + Morning salutation in TZ', () => {
    // 2026-05-09 11:00 UTC == 7:00 AM EDT (DST). Use a UTC moment that
    // lands at 6 AM in NY. EDT in May is UTC-4, so 10:00 UTC = 6:00 EDT.
    const now = new Date('2026-05-09T10:00:00.000Z');
    const out = buildHeader({ tenantTimezone: TZ, name: 'Maya', now });
    expect(out).toContain('Saturday'); // 2026-05-09 is Saturday
    expect(out).toContain('May 9');
    expect(out).toMatch(/6:00am/i);
    expect(out).toContain('Morning, Maya');
    expect(out).toContain('🌅');
  });

  it('switches to Afternoon icon at 13:00 local', () => {
    // 17:00 UTC = 13:00 EDT
    const now = new Date('2026-05-09T17:00:00.000Z');
    const out = buildHeader({ tenantTimezone: TZ, name: 'Maya', now });
    expect(out).toContain('Afternoon, Maya');
    expect(out).toContain('☀️');
  });

  it('escapes HTML in user name', () => {
    const out = buildHeader({ tenantTimezone: TZ, name: '<script>', now: new Date('2026-05-09T10:00:00Z') });
    expect(out).not.toContain('<script>');
    expect(out).toContain('&lt;script&gt;');
  });
});

describe('buildHighlights', () => {
  it('returns empty when nothing notable', () => {
    expect(buildHighlights(makeSummary())).toEqual([]);
  });

  it('flags a big incoming payment', () => {
    const out = buildHighlights(makeSummary({
      yesterday: { paymentsInCents: 120000, expensesOutCents: 0, netCents: 120000, paymentCount: 1, expenseCount: 0 },
      snapshot: { cashTodayCents: 500000, cashYesterdayCents: 380000, arTotalCents: 430000, arInvoiceCount: 3, mtdSpendCents: 0, mtdBudgetTotalCents: null },
    }));
    expect(out.length).toBe(1);
    expect(out[0]).toContain('1,200');
    expect(out[0]).toContain('AR is now');
  });

  it('flags severe overdue cluster (≥2 invoices >30d late)', () => {
    const out = buildHighlights(makeSummary({
      attention: [
        { kind: 'invoice', title: 'INV-A', amountCents: 50000, daysPastDue: 45 },
        { kind: 'invoice', title: 'INV-B', amountCents: 30000, daysPastDue: 35 },
      ],
    }));
    expect(out.some((l) => l.includes('2 invoices') && l.includes('30d'))).toBe(true);
  });

  it('flags imminent tax deadline', () => {
    const out = buildHighlights(makeSummary({ taxDaysUntilQ: 7, taxQEstimateCents: 184000 }));
    expect(out.some((l) => l.includes('Quarterly tax'))).toBe(true);
    expect(out.some((l) => l.includes('1,840'))).toBe(true);
  });

  it('caps at 3 items by priority', () => {
    const out = buildHighlights(makeSummary({
      yesterday: { paymentsInCents: 200000, expensesOutCents: 0, netCents: 200000, paymentCount: 1, expenseCount: 0 },
      attention: [
        { kind: 'invoice', title: 'A', amountCents: 50000, daysPastDue: 45 },
        { kind: 'invoice', title: 'B', amountCents: 30000, daysPastDue: 35 },
      ],
      taxDaysUntilQ: 5, taxQEstimateCents: 200000,
      pendingReviewCount: 8,
      hotBudgets: [{ categoryName: 'Meals', spentCents: 19500, limitCents: 20000, percent: 98 }],
    }));
    expect(out.length).toBe(3);
  });
});

describe('buildSnapshot', () => {
  it('renders cash + AR + MTD with budget', () => {
    const out = buildSnapshot(
      makeSummary({
        snapshot: {
          cashTodayCents: 584000, cashYesterdayCents: 464000,
          arTotalCents: 430000, arInvoiceCount: 3,
          mtdSpendCents: 214000, mtdBudgetTotalCents: 350000,
        },
      }),
      { tenantTimezone: TZ, now: new Date('2026-05-09T10:00:00Z') },
    );
    expect(out[0]).toContain('5,840');
    expect(out[0]).toContain('▲ $1,200');
    expect(out[1]).toContain('4,300');
    expect(out[1]).toContain('3 invoices');
    expect(out[2]).toContain('May spend');
    expect(out[2]).toContain('2,140');
    expect(out[2]).toContain('3,500');
    expect(out[2]).toContain('61%');
  });

  it('omits AR line when AR is zero', () => {
    const out = buildSnapshot(makeSummary(), { tenantTimezone: TZ });
    expect(out.length).toBe(1); // only cash
  });

  it('drops the day-over-day delta when essentially flat', () => {
    const out = buildSnapshot(
      makeSummary({ snapshot: { cashTodayCents: 100000, cashYesterdayCents: 100000, arTotalCents: 0, arInvoiceCount: 0, mtdSpendCents: 0, mtdBudgetTotalCents: null } }),
      { tenantTimezone: TZ },
    );
    expect(out[0]).not.toMatch(/[▲▼]/);
  });

  it('shows MTD without budget when no budget set', () => {
    const out = buildSnapshot(
      makeSummary({ snapshot: { cashTodayCents: 500000, cashYesterdayCents: 500000, arTotalCents: 0, arInvoiceCount: 0, mtdSpendCents: 80000, mtdBudgetTotalCents: null } }),
      { tenantTimezone: TZ, now: new Date('2026-05-09T10:00:00Z') },
    );
    expect(out.some((l) => l.includes('May spend so far') && l.includes('800'))).toBe(true);
    expect(out.every((l) => !/budget/.test(l))).toBe(true);
  });
});

describe('buildTodos', () => {
  it('returns empty when nothing to do', () => {
    expect(buildTodos(makeSummary())).toEqual([]);
  });

  it('numbers prioritized actions', () => {
    const out = buildTodos(makeSummary({
      cpaRequests: [{ id: '1', message: 'need receipt' }],
      pendingReviewCount: 3,
      bankReview: { count: 2, items: [] },
      missingReceipts: { count: 4, items: [] },
    }));
    expect(out[0]).toMatch(/^1\. .*Reply to your CPA/);
    expect(out[1]).toMatch(/^2\. .*bank transaction/);
    expect(out[2]).toMatch(/^3\. .*Review/);
  });

  it('caps at 6 items', () => {
    const out = buildTodos(makeSummary({
      cpaRequests: [{ id: '1', message: 'a' }],
      taxDaysUntilQ: 5, taxQEstimateCents: 100000,
      bankReview: { count: 1, items: [] },
      pendingReviewCount: 1,
      ai: { appliedCount: 0, pendingCount: 1 },
      deductions: [{ id: 'd1', message: 'm' }],
      missingReceipts: { count: 1, items: [] },
      attention: [{ kind: 'invoice', title: 'X', amountCents: 50000, daysPastDue: 30 }],
    }));
    expect(out.length).toBe(6);
  });

  it('skips overdue todos for trivial amounts', () => {
    const out = buildTodos(makeSummary({
      attention: [{ kind: 'invoice', title: 'X', amountCents: 5000, daysPastDue: 30 }],
    }));
    expect(out.length).toBe(0);
  });

  it('uses "today/tomorrow/in Xd" wording for tax deadline', () => {
    expect(buildTodos(makeSummary({ taxDaysUntilQ: 0, taxQEstimateCents: 100000 }))[0]).toContain('today');
    expect(buildTodos(makeSummary({ taxDaysUntilQ: 1, taxQEstimateCents: 100000 }))[0]).toContain('tomorrow');
    expect(buildTodos(makeSummary({ taxDaysUntilQ: 5, taxQEstimateCents: 100000 }))[0]).toContain('5d');
  });
});
