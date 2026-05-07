/**
 * Shared bank-reconciliation primitives.
 *
 * Three call-sites used to inline an identical "post payment + JE +
 * mark invoice paid + update client.totalPaidCents + flip txn matched"
 * transaction:
 *   - apps/web-next/src/app/api/v1/agentbook-expense/bank-transactions/[id]/match/route.ts (HTTP)
 *   - apps/web-next/src/app/api/v1/agentbook/telegram/webhook/route.ts (bnk_match)
 *   - apps/web-next/src/app/api/v1/agentbook/telegram/webhook/route.ts (bnk_m2)
 *
 * That duplication was a footgun: a fix posted in the HTTP route would
 * silently miss the two Telegram paths. Both helpers here run inside a
 * single `$transaction` so the JE / payment / invoice flip are atomic.
 *
 * `source` differentiates the AbEvent for telemetry: 'reconciliation'
 * for the HTTP endpoint, 'telegram_button' / 'telegram_picker' for the
 * two Telegram callback paths.
 */

import 'server-only';
import { prisma as db } from '@naap/database';

export type MatchSource = 'reconciliation' | 'telegram_button' | 'telegram_picker';

export interface ApplyInvoiceMatchInput {
  tenantId: string;
  txnId: string;
  invoiceId: string;
  source: MatchSource;
}

export interface ApplyInvoiceMatchResult {
  paymentId: string;
  jeId: string;
  invoicePaid: boolean;
  paymentAmountCents: number;
  remainingCents: number;
  invoiceNumber: string;
}

export interface ApplyExpenseMatchInput {
  tenantId: string;
  txnId: string;
  expenseId: string;
  source: MatchSource;
}

export interface ApplyExpenseMatchResult {
  ok: true;
  expenseId: string;
}

export class BankMatchError extends Error {
  constructor(
    message: string,
    /** A short, user-presentable code so callers can pick a stable copy. */
    public readonly code:
      | 'txn_not_found'
      | 'invoice_not_found'
      | 'expense_not_found'
      | 'coa_missing',
  ) {
    super(message);
    this.name = 'BankMatchError';
  }
}

/**
 * Apply a confirmed invoice match against a bank transaction.
 *
 * - Posts a balanced JE (debit Cash 1000, credit AR 1100, both = paymentAmount).
 * - Creates an AbPayment row tied to that JE.
 * - Marks the invoice 'paid' if existingPaid + paymentAmount >= invoice.amountCents.
 * - Increments the client's totalPaidCents.
 * - Flips the txn to matchStatus='matched' with matchedInvoiceId.
 * - Emits an AbEvent { eventType: 'bank.txn_matched' } tagged with `source`.
 */
export async function applyInvoiceMatch(
  input: ApplyInvoiceMatchInput,
): Promise<ApplyInvoiceMatchResult> {
  const { tenantId, txnId, invoiceId, source } = input;

  const txn = await db.abBankTransaction.findFirst({
    where: { id: txnId, tenantId },
  });
  if (!txn) throw new BankMatchError('Transaction not found', 'txn_not_found');

  const invoice = await db.abInvoice.findFirst({
    where: { id: invoiceId, tenantId },
    include: { payments: true },
  });
  if (!invoice) throw new BankMatchError('Invoice not found', 'invoice_not_found');

  const amountCents = Math.abs(txn.amount);
  const existingPaid = invoice.payments.reduce((s, p) => s + p.amountCents, 0);
  const remainingBalance = invoice.amountCents - existingPaid;
  const paymentAmount = Math.min(amountCents, remainingBalance);

  // Same precondition as the per-payment route: without a 1000/1100 chart
  // we'd post an unbalanced or dangling JE. Fail loudly.
  const [arAccount, cashAccount] = await Promise.all([
    db.abAccount.findUnique({ where: { tenantId_code: { tenantId, code: '1100' } } }),
    db.abAccount.findUnique({ where: { tenantId_code: { tenantId, code: '1000' } } }),
  ]);
  if (!arAccount || !cashAccount) {
    throw new BankMatchError(
      'AR account (1100) or Cash account (1000) not found. Ensure chart of accounts is seeded.',
      'coa_missing',
    );
  }

  const fullyPaid = existingPaid + paymentAmount >= invoice.amountCents;

  return await db.$transaction(async (tx) => {
    const journalEntry = await tx.abJournalEntry.create({
      data: {
        tenantId,
        date: txn.date,
        memo: `Bank reconciliation — Invoice ${invoice.number}`,
        sourceType: 'payment',
        verified: true,
        lines: {
          create: [
            {
              accountId: cashAccount.id,
              debitCents: paymentAmount,
              creditCents: 0,
              description: `Cash received - Invoice ${invoice.number}`,
            },
            {
              accountId: arAccount.id,
              debitCents: 0,
              creditCents: paymentAmount,
              description: `AR payment - Invoice ${invoice.number}`,
            },
          ],
        },
      },
    });

    const payment = await tx.abPayment.create({
      data: {
        tenantId,
        invoiceId: invoice.id,
        amountCents: paymentAmount,
        method: 'bank_transfer',
        date: txn.date,
        journalEntryId: journalEntry.id,
      },
    });

    await tx.abJournalEntry.update({
      where: { id: journalEntry.id },
      data: { sourceId: payment.id },
    });

    if (fullyPaid) {
      await tx.abInvoice.update({
        where: { id: invoice.id },
        data: { status: 'paid' },
      });
    }

    await tx.abClient.update({
      where: { id: invoice.clientId },
      data: { totalPaidCents: { increment: paymentAmount } },
    });

    await tx.abBankTransaction.update({
      where: { id: txn.id },
      data: { matchedInvoiceId: invoice.id, matchStatus: 'matched' },
    });

    await tx.abEvent.create({
      data: {
        tenantId,
        eventType: 'bank.txn_matched',
        actor: 'user',
        action: {
          transactionId: txn.id,
          targetType: 'invoice',
          invoiceId: invoice.id,
          invoiceNumber: invoice.number,
          amountCents: paymentAmount,
          source,
        },
      },
    });

    return {
      paymentId: payment.id,
      jeId: journalEntry.id,
      invoicePaid: fullyPaid,
      paymentAmountCents: paymentAmount,
      remainingCents: Math.max(0, invoice.amountCents - existingPaid - paymentAmount),
      invoiceNumber: invoice.number,
    };
  });
}

/**
 * Apply a confirmed expense match. No JE — expense JEs are posted at
 * booking time, not at reconciliation. Just link `matchedExpenseId` and
 * emit the matched event.
 */
export async function applyExpenseMatch(
  input: ApplyExpenseMatchInput,
): Promise<ApplyExpenseMatchResult> {
  const { tenantId, txnId, expenseId, source } = input;

  const txn = await db.abBankTransaction.findFirst({
    where: { id: txnId, tenantId },
  });
  if (!txn) throw new BankMatchError('Transaction not found', 'txn_not_found');

  const expense = await db.abExpense.findFirst({
    where: { id: expenseId, tenantId },
  });
  if (!expense) throw new BankMatchError('Expense not found', 'expense_not_found');

  await db.$transaction([
    db.abBankTransaction.update({
      where: { id: txn.id },
      data: { matchedExpenseId: expense.id, matchStatus: 'matched' },
    }),
    db.abEvent.create({
      data: {
        tenantId,
        eventType: 'bank.txn_matched',
        actor: 'user',
        action: {
          transactionId: txn.id,
          targetType: 'expense',
          expenseId: expense.id,
          source,
        },
      },
    }),
  ]);

  return { ok: true, expenseId: expense.id };
}
