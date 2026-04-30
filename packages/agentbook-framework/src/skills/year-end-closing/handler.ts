/**
 * Year-End Closing — Close fiscal year, carry forward balances.
 * Per SKILL.md: closing uses period gate constraint.
 */

export interface YearEndClosingResult {
  year: number;
  periodsClosed: number;
  retainedEarningsCents: number;
  revenueClosedCents: number;
  expensesClosedCents: number;
  carryForwardBalances: { accountCode: string; accountName: string; balanceCents: number }[];
}

export async function closeYear(
  tenantId: string,
  year: number,
  db: any,
): Promise<YearEndClosingResult> {
  // 1. Close all 12 months
  let periodsClosed = 0;
  for (let month = 1; month <= 12; month++) {
    await db.abFiscalPeriod.upsert({
      where: { tenantId_year_month: { tenantId, year, month } },
      update: { status: 'closed', closedAt: new Date(), closedBy: 'year-end-closing' },
      create: { tenantId, year, month, status: 'closed', closedAt: new Date(), closedBy: 'year-end-closing' },
    });
    periodsClosed++;
  }

  // 2. Calculate retained earnings (revenue - expenses for the year)
  const yearStart = new Date(year, 0, 1);
  const yearEnd = new Date(year, 11, 31);

  const revenueAccounts = await db.abAccount.findMany({ where: { tenantId, accountType: 'revenue' } });
  const expenseAccounts = await db.abAccount.findMany({ where: { tenantId, accountType: 'expense' } });

  let totalRevenue = 0;
  for (const acct of revenueAccounts) {
    const lines = await db.abJournalLine.findMany({
      where: { accountId: acct.id, entry: { tenantId, date: { gte: yearStart, lte: yearEnd } } },
    });
    totalRevenue += lines.reduce((s: number, l: any) => s + l.creditCents - l.debitCents, 0);
  }

  let totalExpenses = 0;
  for (const acct of expenseAccounts) {
    const lines = await db.abJournalLine.findMany({
      where: { accountId: acct.id, entry: { tenantId, date: { gte: yearStart, lte: yearEnd } } },
    });
    totalExpenses += lines.reduce((s: number, l: any) => s + l.debitCents - l.creditCents, 0);
  }

  const retainedEarnings = totalRevenue - totalExpenses;

  // 3. Get carry-forward balances (balance sheet accounts only)
  const bsAccounts = await db.abAccount.findMany({
    where: { tenantId, accountType: { in: ['asset', 'liability', 'equity'] }, isActive: true },
  });

  const carryForward: { accountCode: string; accountName: string; balanceCents: number }[] = [];
  for (const acct of bsAccounts) {
    const lines = await db.abJournalLine.findMany({
      where: { accountId: acct.id, entry: { tenantId, date: { lte: yearEnd } } },
    });
    const balance = lines.reduce((s: number, l: any) => s + l.debitCents - l.creditCents, 0);
    if (balance !== 0) {
      carryForward.push({ accountCode: acct.code, accountName: acct.name, balanceCents: balance });
    }
  }

  // 4. Emit event
  await db.abEvent.create({
    data: {
      tenantId,
      eventType: 'year.closed',
      actor: 'agent',
      action: { year, retainedEarnings, periodsClosed },
    },
  });

  return {
    year,
    periodsClosed,
    retainedEarningsCents: retainedEarnings,
    revenueClosedCents: totalRevenue,
    expensesClosedCents: totalExpenses,
    carryForwardBalances: carryForward,
  };
}
