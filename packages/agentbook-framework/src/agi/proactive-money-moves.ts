/**
 * Proactive Money Moves — Predict and prevent financial problems.
 * 5 moves: cash cushion, tax bomb, expense spike, revenue cliff, optimal timing
 */

export interface MoneyMove {
  id: string;
  type: 'cash_cushion' | 'tax_bomb' | 'expense_spike' | 'revenue_cliff' | 'optimal_timing';
  urgency: 'critical' | 'important' | 'informational';
  title: string;
  description: string;
  actionSuggestion: string;
  impactCents: number;
}

export async function analyzeMoneyMoves(tenantId: string, db: any): Promise<MoneyMove[]> {
  const moves: MoneyMove[] = [];

  // Move 1: Cash cushion analysis
  const cashAccount = await db.abAccount.findFirst({ where: { tenantId, code: '1000' } });
  if (cashAccount) {
    const cashLines = await db.abJournalLine.findMany({ where: { accountId: cashAccount.id, entry: { tenantId } } });
    const cashBalance = cashLines.reduce((s: number, l: any) => s + l.debitCents - l.creditCents, 0);

    // Average monthly expenses
    const threeMonthsAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    const recentExpenses = await db.abExpense.findMany({
      where: { tenantId, isPersonal: false, date: { gte: threeMonthsAgo } },
    });
    const totalExpenses = recentExpenses.reduce((s: number, e: any) => s + e.amountCents, 0);
    const monthlyExpenses = totalExpenses / 3;

    if (monthlyExpenses > 0) {
      const runwayMonths = cashBalance / monthlyExpenses;
      if (runwayMonths < 2) {
        moves.push({
          id: 'cash_cushion',
          type: 'cash_cushion',
          urgency: runwayMonths < 1 ? 'critical' : 'important',
          title: 'Cash cushion is thin',
          description: `Only ${runwayMonths.toFixed(1)} months of expenses in cash ($${(cashBalance / 100).toFixed(0)}). Ideal: 3 months ($${(monthlyExpenses * 3 / 100).toFixed(0)}).`,
          actionSuggestion: 'Follow up on overdue invoices or defer non-essential expenses.',
          impactCents: Math.round(monthlyExpenses * 3 - cashBalance),
        });
      }
    }
  }

  // Move 2: Tax bomb prevention (underpayment check)
  const config = await db.abTenantConfig.findUnique({ where: { userId: tenantId } });
  if (config) {
    const currentYear = new Date().getFullYear();
    const quarterlyPayments = await db.abQuarterlyPayment.findMany({
      where: { tenantId, year: currentYear },
    });
    const totalPaid = quarterlyPayments.reduce((s: number, p: any) => s + p.amountPaidCents, 0);
    const totalDue = quarterlyPayments.reduce((s: number, p: any) => s + p.amountDueCents, 0);

    if (totalDue > 0 && totalPaid < totalDue * 0.8) {
      const shortfall = totalDue - totalPaid;
      moves.push({
        id: 'tax_bomb',
        type: 'tax_bomb',
        urgency: 'important',
        title: 'Tax installment shortfall',
        description: `You've paid $${(totalPaid / 100).toFixed(0)} of $${(totalDue / 100).toFixed(0)} in installments. Shortfall: $${(shortfall / 100).toFixed(0)}.`,
        actionSuggestion: 'Catch up on installments to avoid underpayment penalties.',
        impactCents: shortfall,
      });
    }
  }

  // Move 3: Expense spike detection
  const thisMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  const lastMonth = new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1);
  const twoMonthsAgo = new Date(new Date().getFullYear(), new Date().getMonth() - 2, 1);

  const thisMonthExp = await db.abExpense.aggregate({
    where: { tenantId, isPersonal: false, date: { gte: thisMonth } },
    _sum: { amountCents: true },
  });
  const lastMonthExp = await db.abExpense.aggregate({
    where: { tenantId, isPersonal: false, date: { gte: lastMonth, lt: thisMonth } },
    _sum: { amountCents: true },
  });

  const thisTotal = thisMonthExp._sum.amountCents || 0;
  const lastTotal = lastMonthExp._sum.amountCents || 0;

  if (lastTotal > 0 && thisTotal > lastTotal * 1.3) {
    moves.push({
      id: 'expense_spike',
      type: 'expense_spike',
      urgency: 'informational',
      title: 'Spending up this month',
      description: `Expenses are $${(thisTotal / 100).toFixed(0)} this month vs $${(lastTotal / 100).toFixed(0)} last month (+${Math.round((thisTotal / lastTotal - 1) * 100)}%).`,
      actionSuggestion: 'Review new subscriptions or one-time purchases.',
      impactCents: thisTotal - lastTotal,
    });
  }

  // Move 4: Revenue cliff (client concentration)
  const clients = await db.abClient.findMany({ where: { tenantId } });
  const totalRevenue = clients.reduce((s: number, c: any) => s + c.totalBilledCents, 0);
  if (totalRevenue > 0) {
    const topClient = clients.sort((a: any, b: any) => b.totalBilledCents - a.totalBilledCents)[0];
    if (topClient && topClient.totalBilledCents / totalRevenue > 0.5) {
      moves.push({
        id: 'revenue_cliff',
        type: 'revenue_cliff',
        urgency: 'important',
        title: `${topClient.name} is ${Math.round(topClient.totalBilledCents / totalRevenue * 100)}% of revenue`,
        description: `If ${topClient.name} leaves, your monthly income drops by $${(topClient.totalBilledCents / 12 / 100).toFixed(0)}.`,
        actionSuggestion: 'Diversify: pursue new clients or retainer agreements.',
        impactCents: topClient.totalBilledCents,
      });
    }
  }

  return moves.sort((a, b) => {
    const urgencyRank = { critical: 3, important: 2, informational: 1 };
    return urgencyRank[b.urgency] - urgencyRank[a.urgency];
  });
}
