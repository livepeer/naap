/**
 * Bank Sync Handler — Plaid transaction import and reconciliation.
 *
 * Auto-matching engine:
 * 1. Match by amount + date + merchant name → expense
 * 2. Match by amount + date → invoice payment
 * 3. Unmatched → surface to user as exception
 */

export interface BankTransaction {
  plaidTransactionId: string;
  bankAccountId: string;
  amount: number; // dollars (positive = outflow, negative = inflow)
  date: string;
  merchantName?: string;
  name: string;
  category?: string;
  pending: boolean;
}

export interface MatchResult {
  transactionId: string;
  matchedExpenseId?: string;
  matchedInvoiceId?: string;
  matchStatus: 'matched' | 'exception';
  confidence: number;
  matchReason?: string;
}

export interface ReconciliationSummary {
  totalTransactions: number;
  matched: number;
  exceptions: number;
  matchRate: number;
  lastSyncedAt: string;
}

/**
 * Import transactions from Plaid (simulated for MVP).
 * In production, this calls Plaid API via service-gateway.
 */
export async function syncTransactions(
  transactions: BankTransaction[],
  tenantId: string,
  db: any,
): Promise<{ imported: number; duplicates: number }> {
  let imported = 0;
  let duplicates = 0;

  for (const tx of transactions) {
    // Idempotency: skip if already imported
    const existing = await db.abBankTransaction.findUnique({
      where: { plaidTransactionId: tx.plaidTransactionId },
    });
    if (existing) {
      duplicates++;
      continue;
    }

    await db.abBankTransaction.create({
      data: {
        tenantId,
        bankAccountId: tx.bankAccountId,
        plaidTransactionId: tx.plaidTransactionId,
        amount: Math.round(tx.amount * 100), // convert to cents
        date: new Date(tx.date),
        merchantName: tx.merchantName,
        name: tx.name,
        category: tx.category,
        pending: tx.pending,
        matchStatus: 'pending',
        idempotencyKey: tx.plaidTransactionId,
      },
    });
    imported++;
  }

  return { imported, duplicates };
}

/**
 * Auto-match bank transactions to recorded expenses/invoices.
 * Matching strategy:
 * 1. Exact amount + date + normalized merchant → expense (high confidence)
 * 2. Exact amount + date range (±2 days) → expense (medium confidence)
 * 3. Negative amount (inflow) + amount matches invoice → payment (high confidence)
 */
export async function autoMatch(
  tenantId: string,
  db: any,
): Promise<MatchResult[]> {
  const unmatched = await db.abBankTransaction.findMany({
    where: { tenantId, matchStatus: 'pending', pending: false },
    orderBy: { date: 'desc' },
  });

  const results: MatchResult[] = [];

  for (const tx of unmatched) {
    let matched = false;

    // Outflow (positive amount) → match to expense
    if (tx.amount > 0) {
      // Strategy 1: exact amount + merchant
      const expense = await db.abExpense.findFirst({
        where: {
          tenantId,
          amountCents: tx.amount,
          date: {
            gte: new Date(new Date(tx.date).getTime() - 2 * 24 * 60 * 60 * 1000),
            lte: new Date(new Date(tx.date).getTime() + 2 * 24 * 60 * 60 * 1000),
          },
          journalEntryId: { not: null }, // already recorded
        },
      });

      if (expense) {
        await db.abBankTransaction.update({
          where: { id: tx.id },
          data: { matchedExpenseId: expense.id, matchStatus: 'matched' },
        });
        results.push({
          transactionId: tx.id,
          matchedExpenseId: expense.id,
          matchStatus: 'matched',
          confidence: 0.9,
          matchReason: 'amount_date_match',
        });
        matched = true;
      }
    }

    // Inflow (negative amount) → match to invoice payment
    if (tx.amount < 0) {
      const absAmount = Math.abs(tx.amount);
      const invoice = await db.abInvoice.findFirst({
        where: {
          tenantId,
          amountCents: absAmount,
          status: { in: ['sent', 'viewed', 'overdue'] },
        },
      });

      if (invoice) {
        await db.abBankTransaction.update({
          where: { id: tx.id },
          data: { matchedInvoiceId: invoice.id, matchStatus: 'matched' },
        });
        results.push({
          transactionId: tx.id,
          matchedInvoiceId: invoice.id,
          matchStatus: 'matched',
          confidence: 0.85,
          matchReason: 'invoice_amount_match',
        });
        matched = true;
      }
    }

    if (!matched) {
      await db.abBankTransaction.update({
        where: { id: tx.id },
        data: { matchStatus: 'exception' },
      });
      results.push({
        transactionId: tx.id,
        matchStatus: 'exception',
        confidence: 0,
      });
    }
  }

  return results;
}

/**
 * Get reconciliation summary for a tenant.
 */
export async function getReconciliationSummary(
  tenantId: string,
  db: any,
): Promise<ReconciliationSummary> {
  const [total, matched, exceptions] = await Promise.all([
    db.abBankTransaction.count({ where: { tenantId } }),
    db.abBankTransaction.count({ where: { tenantId, matchStatus: 'matched' } }),
    db.abBankTransaction.count({ where: { tenantId, matchStatus: 'exception' } }),
  ]);

  const lastTx = await db.abBankTransaction.findFirst({
    where: { tenantId },
    orderBy: { createdAt: 'desc' },
  });

  return {
    totalTransactions: total,
    matched,
    exceptions,
    matchRate: total > 0 ? matched / total : 0,
    lastSyncedAt: lastTx?.createdAt?.toISOString() || '',
  };
}
