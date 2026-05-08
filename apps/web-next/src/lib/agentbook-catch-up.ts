/**
 * Catch-me-up summary helper (PR 20).
 *
 * Maya types "catch me up" and the bot replies with a tight bulleted
 * summary of what changed since her last interaction: cash delta,
 * paid invoices, auto-categorised expenses, anything needing review,
 * bank-sync count, etc. Same payload feeds the `?catchup=1` web banner.
 *
 * This module owns ONLY the DB-read aggregation. Rendering (Telegram
 * bullets, web banner) lives at the call sites. The helper is a pure
 * read with no LLM and no side effects, so it stays cheap (one query
 * per bucket, all fired in parallel) and is trivially unit-testable.
 *
 * Tenant scoping: every Prisma call here passes `tenantId` in the
 * where-clause. Cross-tenant leakage is impossible at this layer.
 *
 * Buckets are intentionally capped at 8 — the renderer assumes ≤8
 * lines so the Telegram message stays glanceable. If you add a 9th
 * bucket, also extend the renderer/tests.
 */

import 'server-only';
import { prisma as db } from '@naap/database';

export interface CatchUpInput {
  /** Tenant whose activity is being summarised. */
  tenantId: string;
  /** Half-open lower bound — "what changed since this moment". */
  sinceAt: Date;
}

export interface CatchUpSummary {
  /** Coarse cash delta = payments received − expenses booked since. */
  cashChangeCents: number;
  /** Invoices that flipped to `paid` since `sinceAt`. */
  invoicesPaid: { count: number; totalCents: number };
  /** Invoices that flipped to `sent` (and aren't yet paid) since `sinceAt`. */
  invoicesSent: { count: number; totalCents: number };
  /** Expenses confirmed + categorised by the agent since `sinceAt`. */
  expensesAutoCategorized: number;
  /** Expenses still in `pending_review` — Maya should look at these. */
  expensesNeedReview: number;
  /** Plaid-synced bank rows imported since `sinceAt`. */
  bankTransactionsSynced: number;
  /** New AbRecurringRule rows the agent detected since `sinceAt`. */
  newRecurring: number;
  /** Open AbAccountantRequest rows — CPA waiting on Maya. */
  cpaRequestsOpen: number;
}

/**
 * Aggregate the catch-up buckets for a tenant, scoped to
 * `[sinceAt, now)`. Pure DB read — no LLM, no side effects.
 *
 * All queries run in parallel via `Promise.all` so the worst-case
 * latency is the slowest single query, not their sum.
 */
export async function buildCatchUp(input: CatchUpInput): Promise<CatchUpSummary> {
  const { tenantId, sinceAt } = input;

  // The expense list is small (created since `sinceAt`) and we slice
  // it three ways (auto-categorised count, needs-review count) — one
  // findMany is cheaper than three separate counts with overlapping
  // filters, and gives us the rows for any future enrichment.
  const expenseSelect = {
    id: true,
    status: true,
    categoryId: true,
    source: true,
  } as const;

  // Same for invoices: bucket by status in JS instead of two count
  // queries. Anything with `updatedAt >= sinceAt` is considered
  // "changed in this window" — close enough for the catch-up message
  // (we don't have a per-status changed-at timestamp).
  const invoiceSelect = {
    id: true,
    status: true,
    amountCents: true,
  } as const;

  const [
    expenseRows,
    expensesSumSince,
    invoiceRows,
    paymentsSumSince,
    bankTransactionsSynced,
    newRecurring,
    cpaRequestsOpen,
  ] = await Promise.all([
    db.abExpense.findMany({
      where: { tenantId, createdAt: { gte: sinceAt } },
      select: expenseSelect,
    }),
    db.abExpense.aggregate({
      where: { tenantId, createdAt: { gte: sinceAt }, isPersonal: false },
      _sum: { amountCents: true },
    }),
    db.abInvoice.findMany({
      where: { tenantId, updatedAt: { gte: sinceAt } },
      select: invoiceSelect,
    }),
    db.abPayment.aggregate({
      where: { tenantId, date: { gte: sinceAt } },
      _sum: { amountCents: true },
    }),
    db.abBankTransaction.count({
      where: { tenantId, createdAt: { gte: sinceAt } },
    }),
    db.abRecurringRule.count({
      where: { tenantId, createdAt: { gte: sinceAt } },
    }),
    db.abAccountantRequest.count({
      where: { tenantId, status: 'open' },
    }),
  ]);

  // Expense buckets — confirmed AND categorised counts as
  // auto-categorised. pending_review is the review queue. Everything
  // else (rejected, confirmed-but-uncategorised) falls through.
  let expensesAutoCategorized = 0;
  let expensesNeedReview = 0;
  for (const e of expenseRows) {
    if (e.status === 'pending_review') {
      expensesNeedReview += 1;
    } else if (e.status === 'confirmed' && e.categoryId) {
      expensesAutoCategorized += 1;
    }
  }

  // Invoice buckets — paid vs sent. `draft` and `overdue` are not
  // surfaced in this summary (they're better-served by the dashboard
  // attention panel).
  let paidCount = 0;
  let paidTotal = 0;
  let sentCount = 0;
  let sentTotal = 0;
  for (const i of invoiceRows) {
    if (i.status === 'paid') {
      paidCount += 1;
      paidTotal += i.amountCents;
    } else if (i.status === 'sent') {
      sentCount += 1;
      sentTotal += i.amountCents;
    }
  }

  const paymentsSum = paymentsSumSince._sum.amountCents ?? 0;
  const expensesSum = expensesSumSince._sum.amountCents ?? 0;

  return {
    cashChangeCents: paymentsSum - expensesSum,
    invoicesPaid: { count: paidCount, totalCents: paidTotal },
    invoicesSent: { count: sentCount, totalCents: sentTotal },
    expensesAutoCategorized,
    expensesNeedReview,
    bankTransactionsSynced,
    newRecurring,
    cpaRequestsOpen,
  };
}

/**
 * Render a CatchUpSummary as ≤8 bullet lines suitable for Telegram or
 * the web banner. Returns an array (caller joins with `\n`) so
 * consumers can splice in a custom header. Lines are ordered by
 * salience: cash → invoices → expenses → bank → housekeeping.
 *
 * Empty buckets are dropped — a quiet day produces a 1-line "all
 * quiet" message rather than 8 zeros. We always emit at least one
 * line so the bot reply is never blank.
 */
export function renderCatchUpLines(s: CatchUpSummary): string[] {
  const lines: string[] = [];

  if (s.cashChangeCents !== 0) {
    const sign = s.cashChangeCents >= 0 ? '+' : '−';
    const dollars = (Math.abs(s.cashChangeCents) / 100).toFixed(2);
    lines.push(`💵 Cash ${sign}$${dollars}`);
  }
  if (s.invoicesPaid.count > 0) {
    const dollars = (s.invoicesPaid.totalCents / 100).toFixed(2);
    lines.push(
      `✅ ${s.invoicesPaid.count} invoice${s.invoicesPaid.count === 1 ? '' : 's'} paid ($${dollars})`,
    );
  }
  if (s.invoicesSent.count > 0) {
    const dollars = (s.invoicesSent.totalCents / 100).toFixed(2);
    lines.push(
      `📤 ${s.invoicesSent.count} invoice${s.invoicesSent.count === 1 ? '' : 's'} sent ($${dollars})`,
    );
  }
  if (s.expensesAutoCategorized > 0) {
    lines.push(`🏷️ ${s.expensesAutoCategorized} expense${s.expensesAutoCategorized === 1 ? '' : 's'} auto-categorised`);
  }
  if (s.expensesNeedReview > 0) {
    lines.push(
      `⚠️ ${s.expensesNeedReview} expense${s.expensesNeedReview === 1 ? '' : 's'} need${s.expensesNeedReview === 1 ? 's' : ''} review`,
    );
  }
  if (s.bankTransactionsSynced > 0) {
    lines.push(`🏦 ${s.bankTransactionsSynced} bank transaction${s.bankTransactionsSynced === 1 ? '' : 's'} synced`);
  }
  if (s.newRecurring > 0) {
    lines.push(`🔁 ${s.newRecurring} new recurring rule${s.newRecurring === 1 ? '' : 's'} detected`);
  }
  if (s.cpaRequestsOpen > 0) {
    lines.push(`👤 ${s.cpaRequestsOpen} CPA request${s.cpaRequestsOpen === 1 ? '' : 's'} open`);
  }

  if (lines.length === 0) {
    lines.push('All quiet — nothing to catch up on.');
  }

  // Hard cap at 8 even though we only have 8 buckets — defensive.
  return lines.slice(0, 8);
}
