/**
 * Budget monitor (PR 8).
 *
 * Two responsibilities:
 *
 *   1. `checkBudgetsForExpense` — given a candidate new expense, walk
 *      every applicable AbBudget for the tenant and figure out whether
 *      booking it would CROSS the 80% or 100% threshold. The monitor
 *      only fires when this single expense pushes the running total
 *      from below the threshold to at-or-above it; expenses booked
 *      after the budget is already over do NOT re-fire (avoiding
 *      alert spam).
 *
 *   2. `getBudgetProgress` — read-side helper used by the morning
 *      digest and the /agentbook/budgets page to render per-budget
 *      progress bars.
 *
 * Period boundaries respect the tenant's IANA timezone (resolved from
 * AbTenantConfig). PR 8 supports `monthly`, `quarterly`, and `annual`
 * cadences. Unknown periods fall back to monthly so legacy data still
 * produces a sensible window.
 *
 * Category matching:
 *   • If the budget has a `categoryId`, match expenses with the same
 *     `categoryId` directly (cheapest, exact path).
 *   • Otherwise, match by `categoryName` — fuzzy/case-insensitive against
 *     the resolved AbAccount name when the expense has a categoryId, or
 *     against the budget's `categoryName` when the expense passes one in.
 *   • Special-case `categoryName = 'Total'` (the default the POST handler
 *     writes when no category is specified) → matches every business
 *     expense for the tenant.
 */

import 'server-only';
import { prisma as db } from '@naap/database';
import { midnightInTz } from './agentbook-time-aggregator';

export interface BudgetCheckInput {
  tenantId: string;
  categoryId?: string | null;
  categoryName?: string | null;
  expenseAmountCents: number;
  expenseDate?: Date;
  /**
   * When the candidate expense already exists in the DB (typical flow:
   * draft was saved as `pending_review` first, then the user clicks
   * Confirm), set this to its id so the period aggregate excludes it
   * when computing `spentBefore`. Without this, the threshold-crossing
   * detection misfires because both spentBefore and spentAfter would
   * include the candidate.
   */
  excludeExpenseId?: string | null;
}

export interface BudgetAlert {
  budgetId: string;
  categoryName: string | null;
  period: string;
  limitCents: number;
  spentBeforeCents: number;
  spentAfterCents: number;
  threshold: number;
  crossedThreshold: boolean;
  overLimit: boolean;
}

export interface BudgetCheckResult {
  hit: boolean;
  alerts: BudgetAlert[];
}

export interface BudgetProgress {
  budgetId: string;
  categoryName: string | null;
  period: string;
  limitCents: number;
  spentCents: number;
  percent: number;
}

const THRESHOLDS = [80, 100] as const;

interface AbTenantConfigLite {
  timezone?: string | null;
}

async function getTenantTz(tenantId: string): Promise<string> {
  try {
    const cfg = (await db.abTenantConfig.findUnique({
      where: { userId: tenantId },
    })) as AbTenantConfigLite | null;
    return cfg?.timezone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/**
 * Resolve `[start, end)` for a budget period, anchored to the tenant
 * timezone. `monthly` = first-of-this-month → first-of-next-month.
 * `quarterly` = start of this calendar quarter → start of next.
 * `annual` = January 1 → next January 1. Anything else also collapses
 * to monthly.
 */
export function periodBounds(
  period: string,
  tz: string,
  now: Date = new Date(),
): { start: Date; end: Date } {
  const isoToday = (() => {
    try {
      const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: tz,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).formatToParts(now);
      const y = parts.find((p) => p.type === 'year')?.value;
      const m = parts.find((p) => p.type === 'month')?.value;
      const d = parts.find((p) => p.type === 'day')?.value;
      if (y && m && d) return `${y}-${m}-${d}`;
    } catch {
      /* fall through */
    }
    return now.toISOString().slice(0, 10);
  })();
  const [yStr, mStr] = isoToday.split('-');
  const y = Number(yStr);
  const m0 = Number(mStr) - 1;

  if (period === 'annual' || period === 'annually' || period === 'yearly') {
    const start = midnightInTz(y, 0, 1, tz);
    const end = midnightInTz(y + 1, 0, 1, tz);
    return { start, end };
  }
  if (period === 'quarterly' || period === 'quarter') {
    const qStart0 = Math.floor(m0 / 3) * 3;
    const qEnd0 = qStart0 + 3;
    const start = midnightInTz(y, qStart0, 1, tz);
    const end = qEnd0 >= 12
      ? midnightInTz(y + 1, qEnd0 - 12, 1, tz)
      : midnightInTz(y, qEnd0, 1, tz);
    return { start, end };
  }
  // Default + 'monthly'
  const start = midnightInTz(y, m0, 1, tz);
  const end = m0 === 11
    ? midnightInTz(y + 1, 0, 1, tz)
    : midnightInTz(y, m0 + 1, 1, tz);
  return { start, end };
}

interface BudgetRow {
  id: string;
  tenantId: string;
  categoryId: string | null;
  categoryName: string | null;
  amountCents: number;
  period: string;
  alertPercent: number;
}

/**
 * Resolve which AbBudget rows apply to an expense. A budget applies when:
 *   • categoryId matches exactly, OR
 *   • the budget's categoryName matches (case-insensitive substring) the
 *     expense's resolved category name, OR
 *   • the budget's categoryName is "Total" (catch-all).
 */
async function applicableBudgets(
  tenantId: string,
  expCategoryId: string | null | undefined,
  expCategoryName: string | null | undefined,
): Promise<BudgetRow[]> {
  const all = (await db.abBudget.findMany({
    where: { tenantId },
  })) as unknown as BudgetRow[];
  if (all.length === 0) return [];

  // Resolve expense's category name (preferred from caller, else lookup by id)
  let resolvedName = (expCategoryName || '').trim();
  if (!resolvedName && expCategoryId) {
    try {
      const acct = await db.abAccount.findUnique({ where: { id: expCategoryId } });
      resolvedName = acct?.name || '';
    } catch {
      /* leave blank */
    }
  }
  const resolvedNameLower = resolvedName.toLowerCase();

  return all.filter((b) => {
    if (b.categoryId && expCategoryId && b.categoryId === expCategoryId) return true;
    const bName = (b.categoryName || '').trim().toLowerCase();
    if (!bName) return false;
    if (bName === 'total') return true;
    if (!resolvedNameLower) return false;
    return (
      bName === resolvedNameLower
      || bName.includes(resolvedNameLower)
      || resolvedNameLower.includes(bName)
    );
  });
}

async function spendInPeriod(
  tenantId: string,
  budget: BudgetRow,
  start: Date,
  end: Date,
  excludeExpenseId?: string | null,
): Promise<number> {
  const where: Record<string, unknown> = {
    tenantId,
    date: { gte: start, lt: end },
    isPersonal: false,
    // exclude rejected drafts so $200 of cancelled expenses don't trip a budget
    NOT: excludeExpenseId
      ? [{ status: 'rejected' }, { id: excludeExpenseId }]
      : { status: 'rejected' },
  };
  if (budget.categoryId) {
    where.categoryId = budget.categoryId;
  } else if (budget.categoryName && budget.categoryName.toLowerCase() !== 'total') {
    // Name-only budgets: aggregate across any expense whose categoryId
    // resolves to a matching name. We resolve the matching account ids
    // up-front so the aggregate stays in a single query.
    const accts = await db.abAccount.findMany({
      where: { tenantId, accountType: 'expense', isActive: true },
      select: { id: true, name: true },
    });
    const target = budget.categoryName.toLowerCase();
    const matchingIds = accts
      .filter(
        (a: { id: string; name: string }) =>
          a.name.toLowerCase() === target
          || a.name.toLowerCase().includes(target)
          || target.includes(a.name.toLowerCase()),
      )
      .map((a: { id: string }) => a.id);
    if (matchingIds.length === 0) return 0;
    where.categoryId = { in: matchingIds };
  }
  // categoryName 'Total' (or absent) = entire business spend, no extra filter.

  const agg = await db.abExpense.aggregate({
    _sum: { amountCents: true },
    where,
  });
  return agg._sum.amountCents || 0;
}

export async function checkBudgetsForExpense(
  input: BudgetCheckInput,
): Promise<BudgetCheckResult> {
  const tenantId = input.tenantId;
  const budgets = await applicableBudgets(
    tenantId,
    input.categoryId ?? null,
    input.categoryName ?? null,
  );
  if (budgets.length === 0) return { hit: false, alerts: [] };

  const tz = await getTenantTz(tenantId);
  const now = input.expenseDate || new Date();
  const alerts: BudgetAlert[] = [];

  for (const b of budgets) {
    const { start, end } = periodBounds(b.period, tz, now);
    const spentBefore = await spendInPeriod(tenantId, b, start, end, input.excludeExpenseId ?? null);
    const spentAfter = spentBefore + Math.max(0, input.expenseAmountCents);
    const limit = Math.max(1, b.amountCents);

    for (const t of THRESHOLDS) {
      const cutoff = (limit * t) / 100;
      const crossed = spentBefore < cutoff && spentAfter >= cutoff;
      if (!crossed) continue;
      alerts.push({
        budgetId: b.id,
        categoryName: b.categoryName,
        period: b.period,
        limitCents: b.amountCents,
        spentBeforeCents: spentBefore,
        spentAfterCents: spentAfter,
        threshold: t,
        crossedThreshold: true,
        overLimit: t === 100 ? spentAfter > limit : false,
      });
    }
  }

  return { hit: alerts.length > 0, alerts };
}

export async function getBudgetProgress(
  tenantId: string,
  atDate?: Date,
): Promise<BudgetProgress[]> {
  const budgets = (await db.abBudget.findMany({
    where: { tenantId },
    orderBy: { categoryName: 'asc' },
  })) as unknown as BudgetRow[];
  if (budgets.length === 0) return [];

  const tz = await getTenantTz(tenantId);
  const when = atDate || new Date();
  const out: BudgetProgress[] = [];
  for (const b of budgets) {
    const { start, end } = periodBounds(b.period, tz, when);
    const spent = await spendInPeriod(tenantId, b, start, end);
    out.push({
      budgetId: b.id,
      categoryName: b.categoryName,
      period: b.period,
      limitCents: b.amountCents,
      spentCents: spent,
      percent: Math.round((spent / Math.max(1, b.amountCents)) * 100),
    });
  }
  return out;
}
