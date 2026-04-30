/**
 * Tax Form Generation — Schedule C (US) and T2125 (CA).
 * Delegates to jurisdiction pack's TaxFormGenerator interface.
 */

export interface ScheduleCData {
  grossReceipts: number; // Line 1
  returns: number; // Line 2
  costOfGoods: number; // Line 4
  expenses: Record<string, number>; // Line 8-27
  netProfit: number; // Line 31
  taxYear: number;
}

export interface T2125Data {
  grossBusinessIncome: number; // Line 8000
  expenses: Record<string, number>; // Lines 8521-9270
  netIncome: number; // Line 9369
  taxYear: number;
}

export async function generateScheduleC(
  tenantId: string,
  taxYear: number,
  db: any,
): Promise<ScheduleCData> {
  const yearStart = new Date(taxYear, 0, 1);
  const yearEnd = new Date(taxYear, 11, 31);

  // Get all revenue accounts
  const revenueAccounts = await db.abAccount.findMany({
    where: { tenantId, accountType: 'revenue', isActive: true },
  });
  const expenseAccounts = await db.abAccount.findMany({
    where: { tenantId, accountType: 'expense', isActive: true },
  });

  // Aggregate revenue
  const revenueIds = revenueAccounts.map((a: any) => a.id);
  const revenueLines = await db.abJournalLine.findMany({
    where: { accountId: { in: revenueIds }, entry: { tenantId, date: { gte: yearStart, lte: yearEnd } } },
  });
  const grossReceipts = revenueLines.reduce((s: number, l: any) => s + l.creditCents, 0);

  // Aggregate expenses by tax category
  const expenses: Record<string, number> = {};
  for (const acct of expenseAccounts) {
    const lines = await db.abJournalLine.findMany({
      where: { accountId: acct.id, entry: { tenantId, date: { gte: yearStart, lte: yearEnd } } },
    });
    const total = lines.reduce((s: number, l: any) => s + l.debitCents, 0);
    if (total > 0) {
      const category = acct.taxCategory || acct.name;
      expenses[category] = (expenses[category] || 0) + total;
    }
  }

  const totalExpenses = Object.values(expenses).reduce((s, v) => s + v, 0);

  return {
    grossReceipts,
    returns: 0,
    costOfGoods: 0,
    expenses,
    netProfit: grossReceipts - totalExpenses,
    taxYear,
  };
}

export async function generateT2125(
  tenantId: string,
  taxYear: number,
  db: any,
): Promise<T2125Data> {
  const yearStart = new Date(taxYear, 0, 1);
  const yearEnd = new Date(taxYear, 11, 31);

  const revenueAccounts = await db.abAccount.findMany({
    where: { tenantId, accountType: 'revenue', isActive: true },
  });
  const expenseAccounts = await db.abAccount.findMany({
    where: { tenantId, accountType: 'expense', isActive: true },
  });

  const revenueIds = revenueAccounts.map((a: any) => a.id);
  const revenueLines = await db.abJournalLine.findMany({
    where: { accountId: { in: revenueIds }, entry: { tenantId, date: { gte: yearStart, lte: yearEnd } } },
  });
  const grossIncome = revenueLines.reduce((s: number, l: any) => s + l.creditCents, 0);

  const expenses: Record<string, number> = {};
  for (const acct of expenseAccounts) {
    const lines = await db.abJournalLine.findMany({
      where: { accountId: acct.id, entry: { tenantId, date: { gte: yearStart, lte: yearEnd } } },
    });
    const total = lines.reduce((s: number, l: any) => s + l.debitCents, 0);
    if (total > 0) {
      expenses[acct.taxCategory || acct.name] = (expenses[acct.taxCategory || acct.name] || 0) + total;
    }
  }

  const totalExpenses = Object.values(expenses).reduce((s, v) => s + v, 0);

  return {
    grossBusinessIncome: grossIncome,
    expenses,
    netIncome: grossIncome - totalExpenses,
    taxYear,
  };
}

export function exportTaxPackage(
  formData: ScheduleCData | T2125Data,
  format: 'json' | 'csv',
): string {
  if (format === 'csv') {
    const lines = ['Field,Amount'];
    if ('grossReceipts' in formData) {
      lines.push(`Gross Receipts,${formData.grossReceipts}`);
      for (const [k, v] of Object.entries(formData.expenses)) {
        lines.push(`${k},${v}`);
      }
      lines.push(`Net Profit,${formData.netProfit}`);
    } else {
      lines.push(`Gross Business Income,${formData.grossBusinessIncome}`);
      for (const [k, v] of Object.entries(formData.expenses)) {
        lines.push(`${k},${v}`);
      }
      lines.push(`Net Income,${formData.netIncome}`);
    }
    return lines.join('\n');
  }
  return JSON.stringify(formData, null, 2);
}
