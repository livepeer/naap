/**
 * One-Tap Tax Filing — Generate complete tax package from ledger data.
 */

export interface TaxPackage {
  jurisdiction: string;
  taxYear: number;
  grossIncomeCents: number;
  totalExpensesCents: number;
  netIncomeCents: number;
  expensesByCategory: { category: string; amountCents: number }[];
  selfEmploymentTaxCents: number;
  incomeTaxCents: number;
  totalTaxCents: number;
  quarterlyPaymentsMade: number;
  balanceOwingCents: number;
  deductionsSuggested: { name: string; estimatedSavingsCents: number }[];
  receiptCoverage: number;
  readyToFile: boolean;
  missingItems: string[];
}

export async function generateTaxPackage(
  tenantId: string,
  taxYear: number,
  db: any,
): Promise<TaxPackage> {
  const config = await db.abTenantConfig.findUnique({ where: { userId: tenantId } });
  const jurisdiction = config?.jurisdiction || 'us';

  const yearStart = new Date(taxYear, 0, 1);
  const yearEnd = new Date(taxYear, 11, 31);

  // Revenue
  const revenueAccounts = await db.abAccount.findMany({ where: { tenantId, accountType: 'revenue' } });
  const revLines = await db.abJournalLine.findMany({
    where: { accountId: { in: revenueAccounts.map((a: any) => a.id) }, entry: { tenantId, date: { gte: yearStart, lte: yearEnd } } },
  });
  const grossIncome = revLines.reduce((s: number, l: any) => s + l.creditCents, 0);

  // Expenses by category
  const expenseAccounts = await db.abAccount.findMany({ where: { tenantId, accountType: 'expense', isActive: true } });
  const expensesByCategory: { category: string; amountCents: number }[] = [];
  let totalExpenses = 0;

  for (const acct of expenseAccounts) {
    const lines = await db.abJournalLine.findMany({
      where: { accountId: acct.id, entry: { tenantId, date: { gte: yearStart, lte: yearEnd } } },
    });
    const amount = lines.reduce((s: number, l: any) => s + l.debitCents, 0);
    if (amount > 0) {
      expensesByCategory.push({ category: acct.taxCategory || acct.name, amountCents: amount });
      totalExpenses += amount;
    }
  }

  const netIncome = grossIncome - totalExpenses;

  // Tax calculation (simplified)
  const estimate = await db.abTaxEstimate.findFirst({ where: { tenantId }, orderBy: { calculatedAt: 'desc' } });
  const seTax = estimate?.seTaxCents || 0;
  const incomeTax = estimate?.incomeTaxCents || 0;
  const totalTax = seTax + incomeTax;

  // Quarterly payments made
  const payments = await db.abQuarterlyPayment.findMany({ where: { tenantId, year: taxYear } });
  const quarterlyPaid = payments.reduce((s: number, p: any) => s + p.amountPaidCents, 0);

  // Receipt coverage
  const allExpenses = await db.abExpense.count({ where: { tenantId, date: { gte: yearStart, lte: yearEnd }, isPersonal: false } });
  const withReceipts = await db.abExpense.count({ where: { tenantId, date: { gte: yearStart, lte: yearEnd }, isPersonal: false, receiptUrl: { not: null } } });
  const coverage = allExpenses > 0 ? withReceipts / allExpenses : 0;

  // Missing items check
  const missingItems: string[] = [];
  if (coverage < 0.8) missingItems.push(`${allExpenses - withReceipts} expenses missing receipts`);
  if (expensesByCategory.length === 0) missingItems.push('No expenses recorded');
  if (grossIncome === 0) missingItems.push('No revenue recorded');

  // Deduction suggestions
  const suggestions = await db.abDeductionSuggestion.findMany({
    where: { tenantId, status: 'suggested' },
  });

  return {
    jurisdiction,
    taxYear,
    grossIncomeCents: grossIncome,
    totalExpensesCents: totalExpenses,
    netIncomeCents: netIncome,
    expensesByCategory: expensesByCategory.sort((a, b) => b.amountCents - a.amountCents),
    selfEmploymentTaxCents: seTax,
    incomeTaxCents: incomeTax,
    totalTaxCents: totalTax,
    quarterlyPaymentsMade: quarterlyPaid,
    balanceOwingCents: Math.max(0, totalTax - quarterlyPaid),
    deductionsSuggested: suggestions.map((s: any) => ({ name: s.category, estimatedSavingsCents: s.estimatedSavingsCents })),
    receiptCoverage: coverage,
    readyToFile: missingItems.length === 0,
    missingItems,
  };
}
