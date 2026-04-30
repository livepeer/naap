/**
 * Expense Analytics — Category breakdown, trends, vendor analysis, what-if.
 */

export interface CategoryBreakdown {
  categoryId: string;
  categoryName: string;
  totalCents: number;
  count: number;
  percentOfTotal: number;
}

export interface SpendingTrend {
  month: string; // YYYY-MM
  totalCents: number;
  categories: { categoryId: string; name: string; amountCents: number }[];
  changePercent: number | null; // vs prior month
}

export interface VendorAnalysis {
  vendorId: string;
  vendorName: string;
  totalCents: number;
  transactionCount: number;
  avgAmountCents: number;
  lastSeen: string;
}

export interface WhatIfResult {
  scenario: string;
  currentTaxCents: number;
  projectedTaxCents: number;
  savingsCents: number;
  explanation: string;
}

export async function getCategoryBreakdown(
  tenantId: string,
  startDate: string,
  endDate: string,
  db: any,
): Promise<CategoryBreakdown[]> {
  const expenses = await db.abExpense.findMany({
    where: {
      tenantId,
      isPersonal: false,
      date: { gte: new Date(startDate), lte: new Date(endDate) },
      categoryId: { not: null },
    },
    select: { categoryId: true, amountCents: true },
  });

  // Group by category
  const groups: Map<string, { total: number; count: number }> = new Map();
  for (const exp of expenses) {
    const g = groups.get(exp.categoryId) || { total: 0, count: 0 };
    g.total += exp.amountCents;
    g.count += 1;
    groups.set(exp.categoryId, g);
  }

  const grandTotal = Array.from(groups.values()).reduce((s, g) => s + g.total, 0);

  // Get category names
  const categoryIds = Array.from(groups.keys());
  const accounts = await db.abAccount.findMany({
    where: { id: { in: categoryIds } },
    select: { id: true, name: true },
  });
  const nameMap = new Map(accounts.map((a: any) => [a.id, a.name]));

  return Array.from(groups.entries())
    .map(([catId, g]) => ({
      categoryId: catId,
      categoryName: nameMap.get(catId) || 'Unknown',
      totalCents: g.total,
      count: g.count,
      percentOfTotal: grandTotal > 0 ? g.total / grandTotal : 0,
    }))
    .sort((a, b) => b.totalCents - a.totalCents);
}

export async function getSpendingTrend(
  tenantId: string,
  months: number,
  db: any,
): Promise<SpendingTrend[]> {
  const trends: SpendingTrend[] = [];
  const now = new Date();

  for (let i = months - 1; i >= 0; i--) {
    const start = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const end = new Date(now.getFullYear(), now.getMonth() - i + 1, 0);
    const monthKey = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}`;

    const expenses = await db.abExpense.findMany({
      where: {
        tenantId,
        isPersonal: false,
        date: { gte: start, lte: end },
      },
      select: { amountCents: true, categoryId: true },
    });

    const total = expenses.reduce((s: number, e: any) => s + e.amountCents, 0);
    const prevTotal = trends.length > 0 ? trends[trends.length - 1].totalCents : null;

    trends.push({
      month: monthKey,
      totalCents: total,
      categories: [], // Simplified — full breakdown available via getCategoryBreakdown
      changePercent: prevTotal !== null && prevTotal > 0 ? ((total - prevTotal) / prevTotal) * 100 : null,
    });
  }

  return trends;
}

export async function getVendorAnalysis(
  tenantId: string,
  startDate: string,
  endDate: string,
  db: any,
): Promise<VendorAnalysis[]> {
  const vendors = await db.abVendor.findMany({
    where: { tenantId },
    orderBy: { transactionCount: 'desc' },
    take: 20,
  });

  const results: VendorAnalysis[] = [];
  for (const v of vendors) {
    const expenses = await db.abExpense.findMany({
      where: {
        tenantId,
        vendorId: v.id,
        date: { gte: new Date(startDate), lte: new Date(endDate) },
      },
      select: { amountCents: true },
    });

    const total = expenses.reduce((s: number, e: any) => s + e.amountCents, 0);

    results.push({
      vendorId: v.id,
      vendorName: v.name,
      totalCents: total,
      transactionCount: expenses.length,
      avgAmountCents: expenses.length > 0 ? Math.round(total / expenses.length) : 0,
      lastSeen: v.lastSeen?.toISOString() || '',
    });
  }

  return results.sort((a, b) => b.totalCents - a.totalCents);
}

/**
 * What-If Scenario: "What if I prepay $X in expenses?"
 * Calculates tax impact of adding/removing expense amounts.
 */
export function calculateWhatIf(
  currentNetIncomeCents: number,
  changeAmountCents: number,
  taxBrackets: { min: number; max: number | null; rate: number }[],
  seRate: number,
): WhatIfResult {
  const calcTax = (income: number) => {
    let tax = 0;
    for (const b of taxBrackets) {
      if (income <= b.min) break;
      const taxable = Math.min(income, b.max ?? Infinity) - b.min;
      tax += Math.round(taxable * b.rate);
    }
    const seTax = Math.round(income * 0.9235 * seRate);
    return tax + seTax;
  };

  const currentTax = calcTax(currentNetIncomeCents);
  const projectedIncome = currentNetIncomeCents - changeAmountCents; // expense reduces income
  const projectedTax = calcTax(Math.max(0, projectedIncome));
  const savings = currentTax - projectedTax;

  const scenario = changeAmountCents > 0
    ? `Adding $${(changeAmountCents / 100).toFixed(2)} in deductible expenses`
    : `Removing $${(Math.abs(changeAmountCents) / 100).toFixed(2)} in expenses`;

  return {
    scenario,
    currentTaxCents: currentTax,
    projectedTaxCents: projectedTax,
    savingsCents: savings,
    explanation: savings > 0
      ? `This would save $${(savings / 100).toFixed(2)} in taxes.`
      : `This would increase taxes by $${(Math.abs(savings) / 100).toFixed(2)}.`,
  };
}
