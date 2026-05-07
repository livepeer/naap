/**
 * Unit tests for the budget monitor library (PR 8).
 *
 * The monitor sums month-to-date expense spend per applicable budget and
 * detects 80% / 100% threshold crossings *on this expense* — i.e. it
 * fires only when the new expense would push the running total from
 * below the threshold to at-or-above it. This avoids re-firing alerts
 * for every subsequent expense once a budget is already over.
 *
 * Cases:
 *   1. No budget for the tenant         → empty alerts, hit=false
 *   2. Under threshold                   → empty alerts, hit=false
 *   3. Crosses exactly 80%               → 80% alert
 *   4. Crosses exactly 100%              → 100% alert (overLimit=false)
 *   5. Pushes spend over 100%            → 100% alert (overLimit=true)
 *   6. Multi-period (monthly + annual)   → distinct budgets independently
 *      detect their own crossings
 *   7. Already past 80% before this exp  → no re-fire (crossedThreshold=false)
 *   8. Category match by name (fuzzy)    → matches when categoryId is null
 *   9. getBudgetProgress percent rounding → rounds to nearest int
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));

vi.mock('@naap/database', () => {
  return {
    prisma: {
      abBudget: { findMany: vi.fn() },
      abExpense: { aggregate: vi.fn() },
      abTenantConfig: { findUnique: vi.fn() },
      abAccount: { findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn() },
    },
  };
});

import { prisma as db } from '@naap/database';
import {
  checkBudgetsForExpense,
  getBudgetProgress,
} from './agentbook-budget-monitor';

const mockedDb = db as unknown as {
  abBudget: { findMany: ReturnType<typeof vi.fn> };
  abExpense: { aggregate: ReturnType<typeof vi.fn> };
  abTenantConfig: { findUnique: ReturnType<typeof vi.fn> };
  abAccount: {
    findUnique: ReturnType<typeof vi.fn>;
    findFirst: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
  };
};

const TENANT = 'tenant-bdg';

const baseBudget = {
  id: 'b1',
  tenantId: TENANT,
  categoryId: 'cat-meals',
  categoryName: 'Meals',
  amountCents: 20000, // $200
  period: 'monthly',
  alertPercent: 80,
  createdAt: new Date(),
  updatedAt: new Date(),
};

beforeEach(() => {
  mockedDb.abBudget.findMany.mockResolvedValue([]);
  mockedDb.abExpense.aggregate.mockResolvedValue({ _sum: { amountCents: 0 } });
  mockedDb.abTenantConfig.findUnique.mockResolvedValue({
    timezone: 'America/New_York',
  });
  mockedDb.abAccount.findUnique.mockResolvedValue(null);
  mockedDb.abAccount.findFirst.mockResolvedValue(null);
  mockedDb.abAccount.findMany.mockResolvedValue([]);
});

describe('checkBudgetsForExpense', () => {
  it('returns no alerts when the tenant has no budgets', async () => {
    mockedDb.abBudget.findMany.mockResolvedValue([]);
    const r = await checkBudgetsForExpense({
      tenantId: TENANT,
      categoryId: 'cat-meals',
      expenseAmountCents: 5000,
    });
    expect(r.hit).toBe(false);
    expect(r.alerts).toEqual([]);
  });

  it('returns no alerts when spend stays comfortably under 80%', async () => {
    mockedDb.abBudget.findMany.mockResolvedValue([baseBudget]);
    // already spent $50 + this $20 = $70 of $200 = 35%
    mockedDb.abExpense.aggregate.mockResolvedValue({ _sum: { amountCents: 5000 } });
    const r = await checkBudgetsForExpense({
      tenantId: TENANT,
      categoryId: 'cat-meals',
      expenseAmountCents: 2000,
    });
    expect(r.hit).toBe(false);
    expect(r.alerts).toEqual([]);
  });

  it('fires an 80% alert when the expense crosses exactly 80%', async () => {
    mockedDb.abBudget.findMany.mockResolvedValue([baseBudget]);
    // already spent $100 (50%); adding $60 = $160 = 80% on the dot
    mockedDb.abExpense.aggregate.mockResolvedValue({ _sum: { amountCents: 10000 } });
    const r = await checkBudgetsForExpense({
      tenantId: TENANT,
      categoryId: 'cat-meals',
      expenseAmountCents: 6000,
    });
    expect(r.hit).toBe(true);
    expect(r.alerts).toHaveLength(1);
    const a = r.alerts[0];
    expect(a.threshold).toBe(80);
    expect(a.crossedThreshold).toBe(true);
    expect(a.overLimit).toBe(false);
    expect(a.spentBeforeCents).toBe(10000);
    expect(a.spentAfterCents).toBe(16000);
    expect(a.categoryName).toBe('Meals');
    expect(a.period).toBe('monthly');
  });

  it('fires a 100% alert (not overLimit) when the expense lands exactly at 100%', async () => {
    mockedDb.abBudget.findMany.mockResolvedValue([baseBudget]);
    // already $150 (75%); adding $50 = $200 = 100% exactly
    mockedDb.abExpense.aggregate.mockResolvedValue({ _sum: { amountCents: 15000 } });
    const r = await checkBudgetsForExpense({
      tenantId: TENANT,
      categoryId: 'cat-meals',
      expenseAmountCents: 5000,
    });
    expect(r.hit).toBe(true);
    // Both 80% and 100% are crossed by this expense (75% → 100%)
    const t100 = r.alerts.find((x) => x.threshold === 100);
    expect(t100).toBeDefined();
    expect(t100!.crossedThreshold).toBe(true);
    expect(t100!.overLimit).toBe(false);
    expect(t100!.spentAfterCents).toBe(20000);
  });

  it('fires a 100% alert with overLimit=true when the expense pushes spend past the limit', async () => {
    mockedDb.abBudget.findMany.mockResolvedValue([baseBudget]);
    // $190 already (95%); adding $25 = $215 (107%)
    mockedDb.abExpense.aggregate.mockResolvedValue({ _sum: { amountCents: 19000 } });
    const r = await checkBudgetsForExpense({
      tenantId: TENANT,
      categoryId: 'cat-meals',
      expenseAmountCents: 2500,
    });
    expect(r.hit).toBe(true);
    const t100 = r.alerts.find((x) => x.threshold === 100);
    expect(t100).toBeDefined();
    expect(t100!.overLimit).toBe(true);
    expect(t100!.spentAfterCents).toBe(21500);
  });

  it('detects crossings independently for multiple budgets (different periods)', async () => {
    const monthly = { ...baseBudget, id: 'm', amountCents: 20000, period: 'monthly' };
    const annual = {
      ...baseBudget,
      id: 'a',
      amountCents: 100000,
      period: 'annual',
    };
    mockedDb.abBudget.findMany.mockResolvedValue([monthly, annual]);
    // Monthly already $190 → +$25 → $215 (over). Annual already $50000 →
    // +$25 → $50025 (50%). Only monthly should alert.
    mockedDb.abExpense.aggregate.mockImplementation(
      async (args: { where?: Record<string, unknown> }) => {
        const where = args.where || {};
        const dateFilter = where.date as { gte: Date } | undefined;
        if (!dateFilter) return { _sum: { amountCents: 0 } };
        // Monthly window starts on the 1st of THIS month; annual starts in Jan.
        const m = dateFilter.gte.getUTCMonth();
        const isAnnual = m === 0;
        return { _sum: { amountCents: isAnnual ? 5000000 : 19000 } };
      },
    );
    const r = await checkBudgetsForExpense({
      tenantId: TENANT,
      categoryId: 'cat-meals',
      expenseAmountCents: 2500,
    });
    expect(r.hit).toBe(true);
    const periods = r.alerts.map((a) => a.period).sort();
    expect(periods).toContain('monthly');
    // Annual should NOT alert — it's still under 80%
    expect(r.alerts.find((a) => a.period === 'annual')).toBeUndefined();
  });

  it('does NOT re-fire when already past 80% before this expense', async () => {
    mockedDb.abBudget.findMany.mockResolvedValue([baseBudget]);
    // Already at 85% ($170); adding $5 = $175 (87.5%) — still under 100%,
    // and 80% was already crossed PREVIOUSLY, not on this expense.
    mockedDb.abExpense.aggregate.mockResolvedValue({ _sum: { amountCents: 17000 } });
    const r = await checkBudgetsForExpense({
      tenantId: TENANT,
      categoryId: 'cat-meals',
      expenseAmountCents: 500,
    });
    // No threshold crossed by THIS expense.
    expect(r.alerts.find((a) => a.crossedThreshold)).toBeUndefined();
    expect(r.hit).toBe(false);
  });

  it('matches by category name (fuzzy) when the budget has no categoryId', async () => {
    const nameBudget = {
      ...baseBudget,
      id: 'b-name',
      categoryId: null,
      categoryName: 'Meals',
    };
    mockedDb.abBudget.findMany.mockResolvedValue([nameBudget]);
    // The expense has a categoryId — the monitor should resolve its
    // account name and still match this name-based budget.
    mockedDb.abAccount.findUnique.mockResolvedValue({ id: 'cat-meals', name: 'Meals' });
    mockedDb.abAccount.findMany.mockResolvedValue([
      { id: 'cat-meals', name: 'Meals' },
    ]);
    mockedDb.abExpense.aggregate.mockResolvedValue({ _sum: { amountCents: 10000 } });
    const r = await checkBudgetsForExpense({
      tenantId: TENANT,
      categoryId: 'cat-meals',
      expenseAmountCents: 6000, // 50% → 80%
    });
    expect(r.hit).toBe(true);
    expect(r.alerts[0].threshold).toBe(80);
  });
});

describe('parseSetBudgetFromText (regex fallback)', () => {
  it('parses "max $200 on meals each month"', async () => {
    const { parseSetBudgetFromText } = await import('./agentbook-bot-agent');
    const r = parseSetBudgetFromText('max $200 on meals each month');
    expect(r).not.toBeNull();
    expect(r?.amountCents).toBe(20000);
    expect(r?.categoryNameHint.toLowerCase()).toContain('meals');
    expect(r?.period).toBe('monthly');
  });

  it('parses "set $500 monthly travel budget"', async () => {
    const { parseSetBudgetFromText } = await import('./agentbook-bot-agent');
    const r = parseSetBudgetFromText('set $500 monthly travel budget');
    expect(r).not.toBeNull();
    expect(r?.amountCents).toBe(50000);
    expect(r?.categoryNameHint.toLowerCase()).toContain('travel');
    expect(r?.period).toBe('monthly');
  });

  it('parses "limit office supplies to $100/mo"', async () => {
    const { parseSetBudgetFromText } = await import('./agentbook-bot-agent');
    const r = parseSetBudgetFromText('limit office supplies to $100/mo');
    expect(r).not.toBeNull();
    expect(r?.amountCents).toBe(10000);
    expect(r?.categoryNameHint.toLowerCase()).toContain('office');
    expect(r?.period).toBe('monthly');
  });

  it('parses "cap groceries at $400 quarterly"', async () => {
    const { parseSetBudgetFromText } = await import('./agentbook-bot-agent');
    const r = parseSetBudgetFromText('cap groceries at $400 quarterly');
    expect(r).not.toBeNull();
    expect(r?.amountCents).toBe(40000);
    expect(r?.period).toBe('quarterly');
  });

  it('parses k-suffix amounts', async () => {
    const { parseSetBudgetFromText } = await import('./agentbook-bot-agent');
    const r = parseSetBudgetFromText('max $1.5k on travel each year');
    expect(r).not.toBeNull();
    expect(r?.amountCents).toBe(150000);
    expect(r?.period).toBe('annual');
  });

  it('returns null on irrelevant text', async () => {
    const { parseSetBudgetFromText } = await import('./agentbook-bot-agent');
    expect(parseSetBudgetFromText('how much do I owe')).toBeNull();
    expect(parseSetBudgetFromText('spent $20 on lunch')).toBeNull();
  });
});

describe('getBudgetProgress', () => {
  it('returns empty array when no budgets exist', async () => {
    mockedDb.abBudget.findMany.mockResolvedValue([]);
    const list = await getBudgetProgress(TENANT);
    expect(list).toEqual([]);
  });

  it('computes percent for each budget, rounded', async () => {
    mockedDb.abBudget.findMany.mockResolvedValue([baseBudget]);
    // $164 of $200 = 82%
    mockedDb.abExpense.aggregate.mockResolvedValue({ _sum: { amountCents: 16400 } });
    const list = await getBudgetProgress(TENANT);
    expect(list).toHaveLength(1);
    expect(list[0].limitCents).toBe(20000);
    expect(list[0].spentCents).toBe(16400);
    expect(list[0].percent).toBe(82);
    expect(list[0].categoryName).toBe('Meals');
  });
});
