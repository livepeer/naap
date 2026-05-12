/**
 * Morning Digest Cron — runs hourly, fires per-tenant at 7am local.
 *
 * Sends an actionable summary so the user opens Telegram in the morning
 * and sees: cash on hand, what came in / went out yesterday, what's due
 * this week, anything that needs review, and any anomalies. Resend
 * email is the fallback when no Telegram is wired.
 *
 * Reads everything via direct Prisma — does NOT self-fetch over HTTP
 * (removed in earlier refactor along with AGENTBOOK_CORE_URL).
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma as db } from '@naap/database';
import { autoCategorizeForTenant, type AutoCategoryResult } from '@/lib/agentbook-auto-categorize';
import { getDigestPrefs, type DigestPrefs } from '@/lib/agentbook-digest-prefs';
import { buildTipContext, generateTaxTip, generateCashFlowTip } from '@/lib/agentbook-digest-tips';
import { getBudgetProgress, type BudgetProgress } from '@/lib/agentbook-budget-monitor';
import {
  buildHeader,
  buildHighlights,
  buildSnapshot,
  buildTodos,
  type DigestSummary,
} from '@/lib/agentbook-digest-builder';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

interface DigestData {
  cashTodayCents: number;
  cashYesterdayCents: number;       // for the cash delta in the snapshot
  arTotalCents: number;             // outstanding AR (sent + overdue, excluding paid)
  arInvoiceCount: number;
  mtdSpendCents: number;            // month-to-date business expenses (confirmed)
  taxQEstimateCents: number | null; // most-recent quarterly estimate, when available
  yesterday: {
    paymentsInCents: number;
    expensesOutCents: number;
    netCents: number;
    paymentCount: number;
    expenseCount: number;
  };
  pendingReviewCount: number;
  attention: { kind: string; title: string; amountCents?: number; daysPastDue?: number }[];
  upcomingThisWeek: { kind: string; label: string; daysOut: number; amountCents: number }[];
  anomalyCount: number;
  taxDaysUntilQ: number | null;
  bankReview: {
    count: number;
    items: BankReviewItem[];
  };
  cpaRequests: { id: string; message: string; entityType: string; createdAt: Date }[];
  // PR 12 — Smart deduction discovery. Open suggestions surfaced as a
  // digest line + per-suggestion follow-up message with action buttons.
  deductions: DeductionDigestItem[];
  // PR 16 — receipt-expiry warnings. Business-deductible expenses older
  // than 14 days with no receiptUrl and not user-skipped.
  missingReceipts: {
    count: number;
    items: MissingReceiptItem[];
  };
}

interface MissingReceiptItem {
  id: string;
  description: string | null;
  vendorName: string | null;
  amountCents: number;
  date: Date;
  daysOld: number;
}

interface DeductionDigestItem {
  id: string;
  ruleId: string | null;
  message: string | null;
  expenseId: string | null;
  confidence: number;
  suggestedTaxCategory: string | null;
}

interface BankReviewItem {
  id: string;
  amountCents: number;
  merchantName: string | null;
  date: Date;
  /** -1 inflow (incoming credit) / +1 outflow (debit). Used to pick the picker callback. */
  direction: 'inflow' | 'outflow';
  /** Best-guess match the matcher already stored on the row (PR 3). */
  guess: { kind: 'invoice' | 'expense'; targetId: string; label: string; amountCents: number } | null;
}

function fmt$(cents: number): string {
  return '$' + Math.round(cents / 100).toLocaleString('en-US');
}

export async function buildDigest(tenantId: string): Promise<DigestData> {
  const now = new Date();
  const yStart = new Date(now); yStart.setDate(yStart.getDate() - 1); yStart.setHours(0, 0, 0, 0);
  const yEnd = new Date(yStart); yEnd.setHours(23, 59, 59, 999);
  const weekEnd = new Date(now); weekEnd.setDate(weekEnd.getDate() + 7);

  // Cash today (asset accounts journal-line balance)
  const assetAccounts = await db.abAccount.findMany({
    where: { tenantId, accountType: 'asset', isActive: true },
    select: { id: true, journalLines: { select: { debitCents: true, creditCents: true } } },
  });
  const cashTodayCents = assetAccounts.reduce(
    (sum, a) => sum + a.journalLines.reduce((s, l) => s + l.debitCents - l.creditCents, 0),
    0,
  );

  // Yesterday's flow
  const [yPayments, yExpenses] = await Promise.all([
    db.abPayment.findMany({
      where: { tenantId, date: { gte: yStart, lte: yEnd } },
      select: { amountCents: true },
    }),
    db.abExpense.findMany({
      where: { tenantId, date: { gte: yStart, lte: yEnd }, isPersonal: false },
      select: { amountCents: true },
    }),
  ]);
  const paymentsInCents = yPayments.reduce((s, p) => s + p.amountCents, 0);
  const expensesOutCents = yExpenses.reduce((s, e) => s + e.amountCents, 0);

  // Pending review count
  const pendingReviewCount = await db.abExpense.count({
    where: { tenantId, status: 'pending_review' },
  });

  // Overdue invoices (= attention)
  const overdueInvoices = await db.abInvoice.findMany({
    where: { tenantId, status: { in: ['sent', 'viewed', 'overdue'] }, dueDate: { lt: now } },
    include: { client: { select: { name: true } } },
    orderBy: { dueDate: 'asc' },
    take: 5,
  });
  const attention = overdueInvoices.map((inv) => {
    const days = Math.max(1, Math.round((now.getTime() - inv.dueDate.getTime()) / 86_400_000));
    return {
      kind: 'overdue',
      title: `${inv.client?.name || 'Client'} · ${inv.number} · ${days}d overdue`,
      amountCents: inv.amountCents,
      daysPastDue: days,
    };
  });

  // Outstanding AR — for the snapshot. Includes overdue + still-current
  // sent invoices. We re-fetch instead of reusing `overdueInvoices` so
  // the count covers everything outstanding, not just past-due.
  const arRows = await db.abInvoice.findMany({
    where: { tenantId, status: { in: ['sent', 'viewed', 'overdue'] } },
    select: { amountCents: true },
  });
  const arTotalCents = arRows.reduce((s, r) => s + r.amountCents, 0);
  const arInvoiceCount = arRows.length;

  // Cash 24h ago — sum every journal line dated < yStart so we can show
  // a day-over-day delta in the snapshot. Cheap because the full ledger
  // sum was already pulled above; we just diff against the more-recent
  // change to derive the prior balance.
  const recentJl = await db.abJournalLine.findMany({
    where: {
      entry: { tenantId, date: { gte: yStart, lt: now } },
      account: { accountType: 'asset', isActive: true },
    },
    select: { debitCents: true, creditCents: true },
  });
  const cashChange24h = recentJl.reduce((s, l) => s + l.debitCents - l.creditCents, 0);
  const cashYesterdayCents = cashTodayCents - cashChange24h;

  // Month-to-date business expense total for the snapshot's spend line.
  const mtdStart = new Date(now);
  mtdStart.setDate(1);
  mtdStart.setHours(0, 0, 0, 0);
  const mtdRows = await db.abExpense.findMany({
    where: {
      tenantId,
      date: { gte: mtdStart },
      isPersonal: false,
      status: 'confirmed',
      // Soft-deleted rows (PR 26) shouldn't count toward MTD spend.
      OR: [{ deletedAt: null }, { deletedAt: { gt: now } }],
    },
    select: { amountCents: true },
  });
  const mtdSpendCents = mtdRows.reduce((s, r) => s + r.amountCents, 0);

  // Upcoming invoice income + recurring outflows in next 7 days
  const upcomingInvoices = await db.abInvoice.findMany({
    where: {
      tenantId,
      status: { in: ['sent', 'viewed'] },
      dueDate: { gte: now, lte: weekEnd },
    },
    include: { client: { select: { name: true } } },
    orderBy: { dueDate: 'asc' },
    take: 5,
  });
  const recurringRules = await db.abRecurringRule.findMany({
    where: { tenantId, active: true, nextExpected: { gte: now, lte: weekEnd } },
    take: 5,
  });

  const upcomingThisWeek = [
    ...upcomingInvoices.map((inv) => ({
      kind: 'income',
      label: `${inv.client?.name || 'Client'} ${inv.number}`,
      daysOut: Math.max(0, Math.round((inv.dueDate.getTime() - now.getTime()) / 86_400_000)),
      amountCents: inv.amountCents,
    })),
    ...recurringRules.map((r) => ({
      kind: 'recurring_out',
      label: `recurring expense`,
      daysOut: Math.max(0, Math.round((r.nextExpected.getTime() - now.getTime()) / 86_400_000)),
      amountCents: r.amountCents,
    })),
  ].sort((a, b) => a.daysOut - b.daysOut);

  // Anomaly count from advisor/insights logic — single-vendor 3x avg
  const ninetyDaysAgo = new Date(now.getTime() - 90 * 86_400_000);
  const recentExpenses = await db.abExpense.findMany({
    where: { tenantId, date: { gte: ninetyDaysAgo, lte: now } },
    select: { amountCents: true, categoryId: true, date: true },
  });
  const catAvg: Record<string, { total: number; count: number }> = {};
  for (const e of recentExpenses) {
    if (!e.categoryId) continue;
    if (!catAvg[e.categoryId]) catAvg[e.categoryId] = { total: 0, count: 0 };
    catAvg[e.categoryId].total += e.amountCents;
    catAvg[e.categoryId].count++;
  }
  const yesterdayExpensesFull = await db.abExpense.findMany({
    where: { tenantId, date: { gte: yStart, lte: yEnd }, isPersonal: false },
    select: { amountCents: true, categoryId: true },
  });
  let anomalyCount = 0;
  for (const e of yesterdayExpensesFull) {
    if (e.categoryId && catAvg[e.categoryId] && catAvg[e.categoryId].count >= 3) {
      const avg = catAvg[e.categoryId].total / catAvg[e.categoryId].count;
      if (e.amountCents > avg * 3) anomalyCount++;
    }
  }

  // Tax-deadline countdown (US: Apr 15 / Jun 15 / Sep 15 / Jan 15; CA: 15th of Mar/Jun/Sep/Dec)
  const tenantConfig = await db.abTenantConfig.findUnique({ where: { userId: tenantId } });
  const jurisdiction = tenantConfig?.jurisdiction || 'us';
  const usDeadlines = [
    new Date(now.getFullYear(), 3, 15), new Date(now.getFullYear(), 5, 15),
    new Date(now.getFullYear(), 8, 15), new Date(now.getFullYear() + 1, 0, 15),
  ];
  const caDeadlines = [
    new Date(now.getFullYear(), 2, 15), new Date(now.getFullYear(), 5, 15),
    new Date(now.getFullYear(), 8, 15), new Date(now.getFullYear(), 11, 15),
  ];
  const deadlines = jurisdiction === 'ca' ? caDeadlines : usDeadlines;
  const nextDeadline = deadlines.find((d) => d > now);
  const taxDaysUntilQ = nextDeadline
    ? Math.round((nextDeadline.getTime() - now.getTime()) / 86_400_000)
    : null;

  // Most-recent quarterly tax estimate, if the tax plugin has cached one
  // (best-effort: the table may not exist in older schemas, which is fine).
  let taxQEstimateCents: number | null = null;
  try {
    const est = await db.abTaxEstimate.findFirst({
      where: { tenantId, period: { contains: '-Q' } },
      orderBy: { calculatedAt: 'desc' },
      select: { totalTaxCents: true },
    });
    if (est?.totalTaxCents != null) taxQEstimateCents = est.totalTaxCents;
  } catch {
    // Table missing or schema mismatch — silently skip; it's a digest enrichment.
  }

  // Bank reconciliation: transactions in the 0.55–0.85 score band that
  // the matcher couldn't auto-apply. PR 9 surfaces them as interactive
  // per-line messages — we hydrate each row with the best-guess match
  // (whichever id the matcher pre-stored on `matchedInvoiceId` /
  // `matchedExpenseId`) so the [✅ Match] button has a target.
  const bankReviewRaw = await db.abBankTransaction.findMany({
    where: { tenantId, matchStatus: 'exception' },
    orderBy: { date: 'desc' },
    take: 3,
    select: {
      id: true,
      amount: true,
      merchantName: true,
      name: true,
      date: true,
      matchedInvoiceId: true,
      matchedExpenseId: true,
    },
  });
  const bankReviewCount = await db.abBankTransaction.count({
    where: { tenantId, matchStatus: 'exception' },
  });

  // Hydrate the best-guess match label for each row. Done in a small N+1
  // (max 3 rows) — cheaper than a join given the polymorphic target.
  const bankReviewItems: BankReviewItem[] = await Promise.all(
    bankReviewRaw.map(async (b): Promise<BankReviewItem> => {
      const direction: 'inflow' | 'outflow' = b.amount < 0 ? 'inflow' : 'outflow';
      let guess: BankReviewItem['guess'] = null;
      if (b.matchedInvoiceId) {
        const inv = await db.abInvoice.findFirst({
          where: { id: b.matchedInvoiceId, tenantId },
          select: { id: true, number: true, amountCents: true },
        });
        if (inv) {
          guess = { kind: 'invoice', targetId: inv.id, label: inv.number, amountCents: inv.amountCents };
        }
      } else if (b.matchedExpenseId) {
        const exp = await db.abExpense.findFirst({
          where: { id: b.matchedExpenseId, tenantId },
          select: { id: true, description: true, amountCents: true, vendor: { select: { name: true } } },
        });
        if (exp) {
          const lbl = exp.vendor?.name || exp.description || 'expense';
          guess = { kind: 'expense', targetId: exp.id, label: lbl, amountCents: exp.amountCents };
        }
      }
      return {
        id: b.id,
        amountCents: Math.abs(b.amount),
        merchantName: b.merchantName || b.name,
        date: b.date,
        direction,
        guess,
      };
    }),
  );

  // PR 11: open CPA follow-ups (capped at 5 to keep the digest tight).
  const openCpaRequests = await db.abAccountantRequest.findMany({
    where: { tenantId, status: 'open' },
    select: { id: true, message: true, entityType: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
    take: 5,
  });

  // PR 12: top open deduction suggestions, capped so the digest never
  // grows more than 3 follow-up bot messages.
  const openDeductionsRaw = await db.abDeductionSuggestion.findMany({
    where: { tenantId, status: 'open' },
    orderBy: [{ confidence: 'desc' }, { createdAt: 'desc' }],
    take: 3,
  });
  const deductions: DeductionDigestItem[] = openDeductionsRaw.map((d) => ({
    id: d.id,
    ruleId: d.ruleId,
    message: d.message,
    expenseId: d.expenseId,
    confidence: d.confidence,
    suggestedTaxCategory: d.suggestedTaxCategory,
  }));

  // PR 16 — Receipt-expiry warnings. Business-deductible expenses older
  // than 14 days with no receipt attached and not user-skipped. We hard
  // cap at 5 in the digest summary so this section never floods the user
  // even if they haven't kept up with receipts in months.
  const fourteenDaysAgo = new Date(now.getTime() - 14 * 86_400_000);
  const missingReceiptRows = await db.abExpense.findMany({
    where: {
      tenantId,
      isPersonal: false,
      receiptUrl: null,
      OR: [
        { isDeductible: true },
        { taxCategory: { not: null } },
      ],
      AND: [
        {
          OR: [
            { receiptStatus: 'pending' },
            { receiptStatus: null },
          ],
        },
      ],
      date: { lt: fourteenDaysAgo },
    },
    orderBy: { date: 'asc' },
    take: 5,
    select: {
      id: true,
      description: true,
      amountCents: true,
      date: true,
      vendor: { select: { name: true } },
    },
  });
  const missingReceiptCount = await db.abExpense.count({
    where: {
      tenantId,
      isPersonal: false,
      receiptUrl: null,
      OR: [
        { isDeductible: true },
        { taxCategory: { not: null } },
      ],
      AND: [
        {
          OR: [
            { receiptStatus: 'pending' },
            { receiptStatus: null },
          ],
        },
      ],
      date: { lt: fourteenDaysAgo },
    },
  });
  const missingReceiptItems: MissingReceiptItem[] = missingReceiptRows.map((r) => ({
    id: r.id,
    description: r.description,
    vendorName: r.vendor?.name || null,
    amountCents: r.amountCents,
    date: r.date,
    daysOld: Math.floor((now.getTime() - r.date.getTime()) / 86_400_000),
  }));

  return {
    cashTodayCents,
    cashYesterdayCents,
    arTotalCents,
    arInvoiceCount,
    mtdSpendCents,
    taxQEstimateCents,
    yesterday: {
      paymentsInCents,
      expensesOutCents,
      netCents: paymentsInCents - expensesOutCents,
      paymentCount: yPayments.length,
      expenseCount: yExpenses.length,
    },
    pendingReviewCount,
    attention,
    upcomingThisWeek,
    anomalyCount,
    taxDaysUntilQ,
    bankReview: {
      count: bankReviewCount,
      items: bankReviewItems,
    },
    cpaRequests: openCpaRequests,
    deductions,
    missingReceipts: {
      count: missingReceiptCount,
      items: missingReceiptItems,
    },
  };
}

export function composeMessage(
  name: string,
  d: DigestData,
  ai: AutoCategoryResult,
  prefs: DigestPrefs,
  tips: { tax?: string | null; cashFlow?: string | null },
  budgets?: BudgetProgress[],
  ctx: { tenantTimezone: string; now: Date } = { tenantTimezone: 'America/New_York', now: new Date() },
): string {
  const concise = prefs.tone === 'concise';
  const sec = prefs.sections;
  const lines: string[] = [];

  // ─── Header (date + greeting) ─────────────────────────────────────
  lines.push(buildHeader({ tenantTimezone: ctx.tenantTimezone, name, now: ctx.now }));

  // Build the summary object once; reused by highlights / snapshot / todos.
  const hot = (budgets || []).filter((b) => b.percent >= 80);
  const summary: DigestSummary = {
    snapshot: {
      cashTodayCents: d.cashTodayCents,
      cashYesterdayCents: d.cashYesterdayCents,
      arTotalCents: d.arTotalCents,
      arInvoiceCount: d.arInvoiceCount,
      mtdSpendCents: d.mtdSpendCents,
      mtdBudgetTotalCents: hot.length === 0 ? null
        : (budgets || []).filter((b) => b.period === 'monthly').reduce((s, b) => s + b.limitCents, 0) || null,
    },
    yesterday: d.yesterday,
    pendingReviewCount: d.pendingReviewCount,
    attention: d.attention.map((a) => ({
      kind: a.kind, title: a.title, amountCents: a.amountCents, daysPastDue: a.daysPastDue,
    })),
    upcoming: d.upcomingThisWeek.map((u) => ({
      kind: u.kind === 'income' ? 'income' as const : 'outflow' as const,
      label: u.label, daysOut: u.daysOut, amountCents: u.amountCents,
    })),
    anomalyCount: d.anomalyCount,
    taxDaysUntilQ: d.taxDaysUntilQ,
    taxQEstimateCents: d.taxQEstimateCents,
    bankReview: { count: d.bankReview.count, items: d.bankReview.items.map((b) => ({ amountCents: b.amountCents, merchantName: b.merchantName })) },
    missingReceipts: {
      count: d.missingReceipts.count,
      items: d.missingReceipts.items.map((r) => ({ description: r.description, vendorName: r.vendorName, amountCents: r.amountCents, daysOld: r.daysOld })),
    },
    cpaRequests: d.cpaRequests.map((r) => ({ id: r.id, message: r.message })),
    deductions: d.deductions.map((dd) => ({ id: dd.id, message: dd.message })),
    hotBudgets: hot.map((b) => ({ categoryName: b.categoryName, spentCents: b.spentCents, limitCents: b.limitCents, percent: b.percent })),
    ai: { appliedCount: ai.appliedCount, pendingCount: ai.pending.length },
  };

  // ─── Highlights (top 3 must-knows) ────────────────────────────────
  if (sec.highlights) {
    const highlights = buildHighlights(summary);
    if (highlights.length > 0) {
      lines.push('');
      lines.push('📌 <b>Highlights</b>');
      for (const h of highlights) lines.push(`  • ${h}`);
    }
  }

  // ─── Snapshot (cash + AR + MTD spend) ─────────────────────────────
  if (sec.snapshot) {
    const snapshotLines = buildSnapshot(summary, { tenantTimezone: ctx.tenantTimezone, now: ctx.now });
    if (snapshotLines.length > 0) {
      lines.push('');
      lines.push('📊 <b>Snapshot</b>');
      for (const l of snapshotLines) lines.push(`  ${l}`);
    }
  }

  // The legacy `cashOnHand` and `yesterday` standalone lines are now
  // covered by the snapshot above. Render them only when the user has
  // explicitly disabled the snapshot but kept those toggles on.
  if (!sec.snapshot && sec.cashOnHand) {
    lines.push('');
    lines.push(`💰 Cash on hand: <b>${fmt$(d.cashTodayCents)}</b>`);
  }

  if (!sec.snapshot && sec.yesterday && (d.yesterday.paymentCount > 0 || d.yesterday.expenseCount > 0)) {
    const sign = d.yesterday.netCents >= 0 ? '+' : '';
    lines.push(
      `📊 Yesterday: ${sign}${fmt$(d.yesterday.netCents)} (${d.yesterday.paymentCount} payment${d.yesterday.paymentCount === 1 ? '' : 's'} in / ${d.yesterday.expenseCount} expense${d.yesterday.expenseCount === 1 ? '' : 's'} out)`,
    );
  }

  if (sec.pendingReview && d.pendingReviewCount > 0) {
    lines.push(`⚠️  <b>${d.pendingReviewCount}</b> draft expense${d.pendingReviewCount === 1 ? '' : 's'} waiting for review`);
  }

  if (sec.autoCategorize && (ai.appliedCount > 0 || ai.pending.length > 0)) {
    lines.push('');
    if (ai.appliedCount > 0) {
      lines.push(`📁 Auto-categorized <b>${ai.appliedCount}</b> uncategorized expense${ai.appliedCount === 1 ? '' : 's'} overnight (high-confidence picks).`);
    }
    if (ai.pending.length > 0) {
      lines.push(
        `🤔 <b>${ai.pending.length}</b> need${ai.pending.length === 1 ? 's' : ''} a quick check — tap <b>Review pending</b> below or type <code>review</code>.`,
      );
    }
  }

  if (sec.overdue && d.attention.length > 0) {
    lines.push('');
    lines.push(`🚨 <b>Overdue invoices</b>`);
    const limit = concise ? 2 : 3;
    for (const a of d.attention.slice(0, limit)) {
      lines.push(`  • ${escapeHtml(a.title)}${a.amountCents ? ' — ' + fmt$(a.amountCents) : ''}`);
    }
    if (d.attention.length > limit) lines.push(`  … and ${d.attention.length - limit} more`);
  }

  if (sec.thisWeek && d.upcomingThisWeek.length > 0) {
    lines.push('');
    lines.push(`📅 <b>This week</b>`);
    const limit = concise ? 3 : 4;
    for (const u of d.upcomingThisWeek.slice(0, limit)) {
      const arrow = u.kind === 'income' ? '↗' : '↘';
      lines.push(`  ${arrow} ${escapeHtml(u.label)} — ${fmt$(u.amountCents)} in ${u.daysOut}d`);
    }
  }

  if (sec.anomalies && d.anomalyCount > 0) {
    lines.push('');
    lines.push(`📈 ${d.anomalyCount} unusual expense${d.anomalyCount === 1 ? '' : 's'} yesterday — type "expenses" to review`);
  }

  if (d.bankReview && d.bankReview.count > 0) {
    lines.push('');
    lines.push(
      `🏦 <b>Bank reconciliation</b> — ${d.bankReview.count} transaction${d.bankReview.count === 1 ? '' : 's'} need${d.bankReview.count === 1 ? 's' : ''} review`,
    );
    // PR 9: the actual per-line interactive messages (with [✅ Match] /
    // [❌ Not this] buttons) are sent as follow-ups by the cron — see
    // `sendBankReviewMessages`. The summary stays in this digest so the
    // user sees the count even when Telegram is the channel.
    const limit = concise ? 2 : 3;
    for (const b of d.bankReview.items.slice(0, limit)) {
      const dayLabel = new Intl.DateTimeFormat('en-US', { weekday: 'short' }).format(
        new Date(b.date),
      );
      const merchant = b.merchantName || 'unknown';
      lines.push(`  • ${fmt$(b.amountCents)} from ${escapeHtml(merchant)} on ${dayLabel}`);
    }
    if (d.bankReview.count > limit) {
      lines.push(`  … and ${d.bankReview.count - limit} more`);
    }
    lines.push(`  <i>↓ I'll send each one below — tap ✅ to match.</i>`);
  }

  if (sec.taxDeadline && d.taxDaysUntilQ !== null && d.taxDaysUntilQ <= 21) {
    lines.push('');
    lines.push(`📋 <b>Quarterly tax due in ${d.taxDaysUntilQ} days</b> — type "tax" for the estimate`);
  }

  // PR 16: receipt-expiry warnings. Surfaces business-deductible
  // expenses older than 14 days with no receipt attached. Capped at 5
  // (already applied in buildDigest) so the section never grows past
  // a glance-able list. Each row is one-liner: vendor/desc + amount +
  // age. The user can reply "skip receipt for X" or "send receipt for X".
  if (sec.receipts && d.missingReceipts && d.missingReceipts.count > 0) {
    lines.push('');
    const n = d.missingReceipts.count;
    lines.push(`📸 <b>${n} expense${n === 1 ? '' : 's'} missing receipts</b> (older than 14 days)`);
    const limit = concise ? 2 : 5;
    for (const r of d.missingReceipts.items.slice(0, limit)) {
      const label = r.vendorName || r.description || 'expense';
      lines.push(`  • ${escapeHtml(label)} — ${fmt$(r.amountCents)} · ${r.daysOld}d ago`);
    }
    if (d.missingReceipts.count > limit) {
      lines.push(`  … and ${d.missingReceipts.count - limit} more`);
    }
    lines.push(`  <i>Reply "send receipt for &lt;name&gt;" or "skip receipt for &lt;name&gt;".</i>`);
  }

  // PR 12: smart deduction discovery — show count, then send each as
  // its own follow-up message (so the inline buttons land on the right
  // suggestion id).
  if (sec.deductions && d.deductions && d.deductions.length > 0) {
    lines.push('');
    const n = d.deductions.length;
    lines.push(`💡 <b>${n} possible missed deduction${n === 1 ? '' : 's'}</b>`);
    const limit = concise ? 1 : 3;
    for (const dd of d.deductions.slice(0, limit)) {
      const preview = (dd.message || '').slice(0, 140);
      if (preview) lines.push(`  • ${escapeHtml(preview)}`);
    }
    lines.push(`  <i>↓ Tap below to apply or skip.</i>`);
  }

  // PR 11: open CPA follow-ups. Quietly skipped when there are none
  // (the section name shouldn't ever appear empty).
  if (sec.cpa_requests && d.cpaRequests && d.cpaRequests.length > 0) {
    lines.push('');
    lines.push(`📒 <b>From your CPA</b> — ${d.cpaRequests.length} open question${d.cpaRequests.length === 1 ? '' : 's'}`);
    const limit = concise ? 2 : 4;
    for (const r of d.cpaRequests.slice(0, limit)) {
      lines.push(`  • ${escapeHtml(r.message.slice(0, 140))}`);
    }
    if (d.cpaRequests.length > limit) lines.push(`  … and ${d.cpaRequests.length - limit} more`);
  }

  if (sec.taxTips && tips.tax) {
    lines.push('');
    lines.push(`💡 <b>Tax tip:</b> ${escapeHtml(tips.tax)}`);
  }

  if (sec.cashFlowTips && tips.cashFlow) {
    lines.push('');
    lines.push(`🌊 <b>Cash flow:</b> ${escapeHtml(tips.cashFlow)}`);
  }

  // 💡 Budgets — only surface budgets that are >=80% used. Anything
  // green/under-budget stays out of the digest so the section doesn't
  // become noise once a tenant accumulates a chart of caps.
  if (sec.budgets && budgets && budgets.length > 0) {
    const hot = budgets.filter((b) => b.percent >= 80);
    if (hot.length > 0) {
      lines.push('');
      lines.push(`💡 <b>Budgets</b>`);
      const limit = concise ? 3 : 5;
      for (const b of hot.slice(0, limit)) {
        const bar = renderBudgetBar(b.percent);
        const label = b.categoryName || 'Total';
        const periodWord = b.period === 'annual' ? 'yr' : b.period === 'quarterly' ? 'qtr' : 'mo';
        lines.push(
          `  ${bar} <b>${escapeHtml(label)}</b> — ${fmt$(b.spentCents)}/${fmt$(b.limitCents)}/${periodWord} (${b.percent}%)`,
        );
      }
      if (hot.length > limit) lines.push(`  … and ${hot.length - limit} more`);
    }
  }

  // ─── Today's TODO (prioritized action list) ───────────────────────
  if (sec.todos) {
    const todos = buildTodos(summary);
    if (todos.length > 0) {
      lines.push('');
      lines.push('✅ <b>Today\'s TODO</b>');
      for (const t of todos) lines.push(`  ${t}`);
    }
  }

  if (!prefs.setupComplete) {
    lines.push('');
    lines.push(`<i>Want to customize what you see and when? Type <code>setup briefing</code>.</i>`);
  } else {
    lines.push('');
    lines.push(`<i>Reply to tune this — "shorter", "skip tax tips", "move to 8am" all work. Or "setup briefing" to start over.</i>`);
  }

  return lines.join('\n');
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Tiny ASCII progress bar for budget rows. 8 cells; filled with █, empty
 * with ░. Coloured-emoji equivalents could replace this later but the
 * monochrome version renders cleanly across Telegram clients and email.
 */
function renderBudgetBar(percent: number): string {
  const cells = 8;
  const filled = Math.max(0, Math.min(cells, Math.round((percent / 100) * cells)));
  const overflowing = percent >= 100;
  // Use a different lead emoji for over-limit so the user can spot it
  // without parsing the percentage.
  const lead = overflowing ? '🔴' : percent >= 80 ? '🟡' : '🟢';
  return `${lead} ${'█'.repeat(filled)}${'░'.repeat(Math.max(0, cells - filled))}`;
}

async function sendTelegram(
  tenantId: string,
  message: string,
  inlineKeyboard?: { text: string; callback_data: string }[][],
): Promise<boolean> {
  const bot = await db.abTelegramBot.findFirst({ where: { tenantId, enabled: true } });
  if (!bot) return false;
  const chats = Array.isArray(bot.chatIds) ? (bot.chatIds as string[]) : [];
  if (chats.length === 0) return false;
  const replyMarkup = inlineKeyboard ? { inline_keyboard: inlineKeyboard } : undefined;
  for (const chatId of chats) {
    await fetch(`https://api.telegram.org/bot${bot.botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: 'HTML',
        ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
      }),
    }).catch(() => null);
  }
  return true;
}

/**
 * Send one Telegram message per bank-review item with [✅ Match] /
 * [❌ Not this] / [Pick another] buttons. Each row is its own message
 * because Telegram inline keyboards bind to a single message.
 *
 * Callback layout (≤64 bytes — Telegram's hard cap):
 *   bnk_match:<txnId>             → confirm the bot's stored best guess
 *   bnk_skip:<txnId>              → mark ignored
 *   bnk_pickinvoice:<txnId>       → open the invoice picker (inflow)
 *   bnk_pickexpense:<txnId>       → open the expense picker (outflow)
 */
async function sendBankReviewMessages(
  tenantId: string,
  items: BankReviewItem[],
): Promise<void> {
  const bot = await db.abTelegramBot.findFirst({ where: { tenantId, enabled: true } });
  if (!bot) return;
  const chats = Array.isArray(bot.chatIds) ? (bot.chatIds as string[]) : [];
  if (chats.length === 0) return;

  for (const item of items) {
    const dayLabel = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric' }).format(
      new Date(item.date),
    );
    const merchant = item.merchantName || 'unknown';
    const directionWord = item.direction === 'inflow' ? 'from' : 'to';
    let text: string;
    if (item.guess) {
      const guessLabel = escapeHtml(item.guess.label);
      const guessAmount = fmt$(item.guess.amountCents);
      text =
        `💰 ${fmt$(item.amountCents)} ${directionWord} ${escapeHtml(merchant)} on ${dayLabel}` +
        ` — possible match: <b>${guessLabel}</b> (${guessAmount}). Match it?`;
    } else {
      text = `💰 ${fmt$(item.amountCents)} ${directionWord} ${escapeHtml(merchant)} on ${dayLabel} — no obvious match. Pick one?`;
    }

    // Picker callback depends on direction: inflow ⇒ invoice picker,
    // outflow ⇒ expense picker. The match/skip ones are direction-agnostic.
    const pickerCb =
      item.direction === 'inflow'
        ? `bnk_pickinvoice:${item.id}`
        : `bnk_pickexpense:${item.id}`;
    const buttons: { text: string; callback_data: string }[][] = [];
    if (item.guess) {
      buttons.push([
        { text: '✅ Match', callback_data: `bnk_match:${item.id}` },
        { text: '❌ Not this', callback_data: `bnk_skip:${item.id}` },
      ]);
      buttons.push([{ text: '🔍 Pick another', callback_data: pickerCb }]);
    } else {
      buttons.push([
        { text: '🔍 Pick a match', callback_data: pickerCb },
        { text: '❌ Skip', callback_data: `bnk_skip:${item.id}` },
      ]);
    }

    for (const chatId of chats) {
      await fetch(`https://api.telegram.org/bot${bot.botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          parse_mode: 'HTML',
          reply_markup: { inline_keyboard: buttons },
        }),
      }).catch(() => null);
    }
  }
}

/**
 * PR 12 — per-suggestion deduction follow-up message. The summary line
 * in the digest tells the user how many; this fires one inline-keyboard
 * message per suggestion so the [✅ Apply] button has a unique target.
 *
 * Callback prefixes are 47B at most: `dd_apply:<uuid>` = 9 + 36 = 45,
 * well under Telegram's 64-byte cap on `callback_data`.
 */
async function sendDeductionMessages(
  tenantId: string,
  items: DeductionDigestItem[],
): Promise<void> {
  const bot = await db.abTelegramBot.findFirst({ where: { tenantId, enabled: true } });
  if (!bot) return;
  const chats = Array.isArray(bot.chatIds) ? (bot.chatIds as string[]) : [];
  if (chats.length === 0) return;

  for (const item of items) {
    const text = `💡 ${escapeHtml((item.message || 'Possible missed deduction').slice(0, 600))}`;
    const buttons: { text: string; callback_data: string }[][] = [
      [
        { text: '✅ Apply', callback_data: `dd_apply:${item.id}` },
        { text: '❌ Skip', callback_data: `dd_skip:${item.id}` },
      ],
      [{ text: '💬 Tell me more', callback_data: `dd_explain:${item.id}` }],
    ];
    for (const chatId of chats) {
      await fetch(`https://api.telegram.org/bot${bot.botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          parse_mode: 'HTML',
          reply_markup: { inline_keyboard: buttons },
        }),
      }).catch(() => null);
    }
  }
}

async function sendEmail(userId: string, htmlMessage: string): Promise<boolean> {
  if (!process.env.RESEND_API_KEY) return false;
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user?.email) return false;
  // Strip HTML tags for the plaintext fallback.
  const text = htmlMessage.replace(/<[^>]+>/g, '');
  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: process.env.RESEND_FROM || 'AgentBook <noreply@agentbook.app>',
      to: user.email,
      subject: 'Your AgentBook morning summary',
      html: htmlMessage.replace(/\n/g, '<br>'),
      text,
    }),
  }).catch(() => null);
  return true;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const auth = request.headers.get('authorization');
  if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Auto-enable digest for tenants who have a Telegram bot connected but
  // haven't explicitly opted in — better default for daily-driver users.
  const tenantsWithBot = await db.abTelegramBot.findMany({
    where: { enabled: true },
    select: { tenantId: true },
  });
  const botTenantIds = new Set(tenantsWithBot.map((b) => b.tenantId));

  const tenants = await db.abTenantConfig.findMany({
    where: {
      OR: [
        { dailyDigestEnabled: true },
        { userId: { in: Array.from(botTenantIds) } },
      ],
    },
  });

  const now = new Date();
  const targetParam = request.nextUrl.searchParams.get('hour');
  const targetHour = targetParam ? parseInt(targetParam, 10) : 7;

  let sent = 0;
  let skipped = 0;
  let errors = 0;

  for (const tenant of tenants) {
    try {
      // Read the tenant's customized prefs (time, sections, tone).
      // Default time is 7am if they haven't run setup yet.
      const prefs = await getDigestPrefs(tenant.userId);

      const fmtH = new Intl.DateTimeFormat('en-US', {
        hour: 'numeric',
        hour12: false,
        timeZone: tenant.timezone || 'America/New_York',
      });
      const fmtM = new Intl.DateTimeFormat('en-US', {
        minute: 'numeric',
        timeZone: tenant.timezone || 'America/New_York',
      });
      const localHour = parseInt(fmtH.format(now), 10);
      const localMinute = parseInt(fmtM.format(now), 10);
      // Allow on-demand testing via ?hour=now to bypass the time gate.
      const bypass = targetParam === 'now';
      // Honor the tenant's preferred hour. Cron fires hourly, so we
      // match on hour and tolerate any minute within that hour.
      const targetHourForTenant = targetParam ? targetHour : prefs.hour;
      if (!bypass && localHour !== targetHourForTenant) {
        skipped++;
        continue;
      }
      void localMinute; // currently unused — reserved for future minute-precision firing

      // Run the daily auto-categorizer first so its results show up in
      // today's digest. The helper short-circuits if it already ran today.
      const ai = await autoCategorizeForTenant(tenant.userId);

      const digest = await buildDigest(tenant.userId);
      const user = await db.user.findUnique({ where: { id: tenant.userId } });
      const name = user?.displayName?.split(' ')[0] || 'there';

      // Generate contextual tax + cash flow tips if the tenant wants them.
      let taxTip: string | null = null;
      let cashFlowTip: string | null = null;
      if (prefs.sections.taxTips || prefs.sections.cashFlowTips) {
        const ctx = await buildTipContext(tenant.userId);
        if (prefs.sections.taxTips) {
          const t = await generateTaxTip(ctx);
          taxTip = t?.text ?? null;
        }
        if (prefs.sections.cashFlowTips) {
          const t = await generateCashFlowTip(ctx);
          cashFlowTip = t?.text ?? null;
        }
      }

      // Budgets — only fetch if the tenant wants them in their digest.
      let budgets: BudgetProgress[] = [];
      if (prefs.sections.budgets) {
        try {
          budgets = await getBudgetProgress(tenant.userId);
        } catch (err) {
          console.warn('[morning-digest] budget fetch failed', tenant.userId, err);
        }
      }

      const message = composeMessage(
        name,
        digest,
        ai,
        prefs,
        { tax: taxTip, cashFlow: cashFlowTip },
        budgets,
        { tenantTimezone: tenant.timezone || 'America/New_York', now },
      );
      // Review button covers BOTH queues — AI suggestions AND uncategorized
      // draft expenses. The unified review batch handler walks through both.
      const reviewCount = ai.pending.length + digest.pendingReviewCount;
      const buttons: { text: string; callback_data: string }[][] = [];
      if (reviewCount > 0) {
        buttons.push([{ text: `👀 Review ${reviewCount} item${reviewCount === 1 ? '' : 's'}`, callback_data: 'review_drafts' }]);
      }
      if (!prefs.setupComplete) {
        buttons.push([{ text: '⚙️ Set up briefing', callback_data: 'setup_briefing' }]);
      }
      const keyboard = buttons.length > 0 ? buttons : undefined;
      const tgSent = await sendTelegram(tenant.userId, message, keyboard);
      if (!tgSent) await sendEmail(tenant.userId, message);

      // PR 9: per-line interactive bank-reconciliation messages. Capped
      // at 3/tenant/day (already enforced by `take: 3` on the query) so
      // the inbox doesn't get spammed. Skipped entirely if Telegram
      // wasn't reachable — the email fallback is text-only and these
      // need callbacks.
      //
      // Idempotency: cron fires hourly and the `?hour=now` debug bypass
      // exists, so the same tenant can land here twice in a UTC day. We
      // gate on an AbEvent stamped with today's UTC date — present means
      // we've already sent today, skip. Per-call `take: 3` only covers
      // *this* call's list; without this gate a retry resends the same
      // 3 items (or different 3 items) and double-spams the inbox.
      if (tgSent && digest.bankReview.items.length > 0) {
        const todayUTC = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
        const dayStart = new Date(`${todayUTC}T00:00:00.000Z`);
        const dayEnd = new Date(`${todayUTC}T23:59:59.999Z`);
        const alreadySent = await db.abEvent.findFirst({
          where: {
            tenantId: tenant.userId,
            eventType: 'bank.digest_sent_today',
            createdAt: { gte: dayStart, lte: dayEnd },
          },
          select: { id: true },
        });
        if (!alreadySent) {
          await sendBankReviewMessages(tenant.userId, digest.bankReview.items);
          await db.abEvent.create({
            data: {
              tenantId: tenant.userId,
              eventType: 'bank.digest_sent_today',
              actor: 'system',
              action: { dateUTC: todayUTC, count: digest.bankReview.items.length },
            },
          });
        }
      }

      // PR 12: per-suggestion deduction-discovery follow-ups. Same
      // once-per-UTC-day gate as the bank-review messages so the cron
      // doesn't double-send when it fires more than once for a tenant.
      if (tgSent && prefs.sections.deductions && digest.deductions.length > 0) {
        const todayUTC = new Date().toISOString().slice(0, 10);
        const dayStart = new Date(`${todayUTC}T00:00:00.000Z`);
        const dayEnd = new Date(`${todayUTC}T23:59:59.999Z`);
        const alreadySent = await db.abEvent.findFirst({
          where: {
            tenantId: tenant.userId,
            eventType: 'deduction.digest_sent_today',
            createdAt: { gte: dayStart, lte: dayEnd },
          },
          select: { id: true },
        });
        if (!alreadySent) {
          await sendDeductionMessages(tenant.userId, digest.deductions);
          await db.abEvent.create({
            data: {
              tenantId: tenant.userId,
              eventType: 'deduction.digest_sent_today',
              actor: 'system',
              action: { dateUTC: todayUTC, count: digest.deductions.length },
            },
          });
        }
      }
      sent++;
    } catch (err) {
      console.error('[morning-digest] tenant error', tenant.userId, err);
      errors++;
    }
  }

  return NextResponse.json({
    ok: true,
    sent,
    skipped,
    errors,
    timestamp: new Date().toISOString(),
  });
}
