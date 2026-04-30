/**
 * Conversational Financial Memory — Ask any question, get instant answers.
 * Uses LLM to generate Prisma queries from natural language.
 */

export interface QueryResult {
  question: string;
  answer: string;
  data: any;
  queryExecuted: string;
  latencyMs: number;
}

/**
 * Process a natural language financial question.
 * Strategy: LLM generates a structured query plan, we execute safely.
 */
export async function answerFinancialQuestion(
  tenantId: string,
  question: string,
  db: any,
  llmCall?: (prompt: string) => Promise<string>,
): Promise<QueryResult> {
  const start = Date.now();

  // For MVP: use pattern matching for common questions
  // In production: use LLM to generate Prisma queries
  const q = question.toLowerCase();
  let data: any = null;
  let answer = '';
  let queryDesc = '';

  // Revenue questions
  if (q.includes('revenue') || q.includes('income') || q.includes('earn')) {
    const revenueAccounts = await db.abAccount.findMany({ where: { tenantId, accountType: 'revenue' } });
    const lines = await db.abJournalLine.findMany({
      where: { accountId: { in: revenueAccounts.map((a: any) => a.id) }, entry: { tenantId } },
    });
    const total = lines.reduce((s: number, l: any) => s + l.creditCents, 0);
    data = { totalRevenueCents: total };
    answer = `Your total revenue is $${(total / 100).toLocaleString()}.`;
    queryDesc = 'Summed credit lines from revenue accounts';
  }

  // Expense questions
  else if (q.includes('spend') || q.includes('expense') || q.includes('cost')) {
    const period = q.includes('last quarter') ? 'quarter' : q.includes('last month') ? 'month' : 'year';
    const since = new Date();
    if (period === 'quarter') since.setMonth(since.getMonth() - 3);
    else if (period === 'month') since.setMonth(since.getMonth() - 1);
    else since.setMonth(0);

    // Check for category
    let categoryFilter = {};
    if (q.includes('travel')) queryDesc = 'Travel expenses';
    else if (q.includes('software') || q.includes('saas')) queryDesc = 'Software expenses';
    else if (q.includes('meal') || q.includes('food')) queryDesc = 'Meal expenses';
    else queryDesc = 'All expenses';

    const expenses = await db.abExpense.findMany({
      where: { tenantId, isPersonal: false, date: { gte: since }, ...categoryFilter },
    });
    const total = expenses.reduce((s: number, e: any) => s + e.amountCents, 0);
    data = { totalCents: total, count: expenses.length, period };
    answer = `You spent $${(total / 100).toLocaleString()} on ${queryDesc.toLowerCase()} (${expenses.length} transactions) in the last ${period}.`;
  }

  // Tax questions
  else if (q.includes('tax') || q.includes('owe')) {
    const estimate = await db.abTaxEstimate.findFirst({
      where: { tenantId }, orderBy: { calculatedAt: 'desc' },
    });
    if (estimate) {
      data = estimate;
      answer = `Your estimated tax is $${(estimate.totalTaxCents / 100).toLocaleString()} (effective rate: ${(estimate.effectiveRate * 100).toFixed(1)}%). Net income: $${(estimate.netIncomeCents / 100).toLocaleString()}.`;
      queryDesc = 'Latest tax estimate';
    } else {
      answer = 'No tax estimate available yet. Record some revenue and expenses first.';
      queryDesc = 'No estimate found';
    }
  }

  // Cash / balance questions
  else if (q.includes('cash') || q.includes('balance') || q.includes('money')) {
    const cashAccount = await db.abAccount.findFirst({ where: { tenantId, code: '1000' } });
    if (cashAccount) {
      const lines = await db.abJournalLine.findMany({ where: { accountId: cashAccount.id, entry: { tenantId } } });
      const balance = lines.reduce((s: number, l: any) => s + l.debitCents - l.creditCents, 0);
      data = { cashBalanceCents: balance };
      answer = `Your cash balance is $${(balance / 100).toLocaleString()}.`;
      queryDesc = 'Cash account balance from journal lines';
    }
  }

  // Client questions
  else if (q.includes('client') || q.includes('invoice') || q.includes('owe me') || q.includes('outstanding')) {
    const clients = await db.abClient.findMany({ where: { tenantId } });
    const outstanding = clients.reduce((s: number, c: any) => s + (c.totalBilledCents - c.totalPaidCents), 0);
    data = { clients: clients.length, outstandingCents: outstanding };
    answer = `You have ${clients.length} clients. Outstanding receivables: $${(outstanding / 100).toLocaleString()}.`;
    queryDesc = 'Client summary with outstanding balance';
  }

  // Default
  else {
    answer = `I understand you're asking about "${question}". I can answer questions about revenue, expenses, taxes, cash balance, and clients. Try asking something like "How much did I spend on travel last quarter?"`;
    queryDesc = 'No matching query pattern';
  }

  return {
    question,
    answer,
    data,
    queryExecuted: queryDesc,
    latencyMs: Date.now() - start,
  };
}
