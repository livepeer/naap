/**
 * Generate contextual, actionable tax-planning + cash-flow tips for the
 * morning digest. Tips MUST reference a specific number from the
 * tenant's data and end with something the user can act on. Generic
 * platitudes are dropped at parse time.
 *
 * Backed by Gemini, with a deterministic fallback so the digest never
 * goes empty even when the LLM key isn't configured.
 */

import 'server-only';
import { prisma as db } from '@naap/database';

export interface TipContext {
  jurisdiction: string;
  cashTodayCents: number;
  monthlyBurnCents: number;
  monthlyRevenueCents: number;
  ytdRevenueCents: number;
  ytdExpensesCents: number;
  ytdNetIncomeCents: number;
  taxDaysUntilQ: number | null;
  taxQuarterlyEstimateCents: number | null;
  topCategoriesYtd: { category: string; amountCents: number }[];
  outstandingInvoiceCents: number;
  upcomingInvoiceCents: number;
  pastDueInvoiceCount: number;
  recurringMonthlyCents: number;
  receiptCoveragePct: number;
}

export interface DigestTip {
  text: string;          // 1-2 sentences, references concrete numbers
  source: 'llm' | 'rule';
}

/**
 * Pull the data the tip generator needs in one query batch.
 */
export async function buildTipContext(tenantId: string): Promise<TipContext> {
  const now = new Date();
  const yearStart = new Date(now.getFullYear(), 0, 1);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const ninetyDaysAgo = new Date(now.getTime() - 90 * 86_400_000);

  const tenantConfig = await db.abTenantConfig.findUnique({ where: { userId: tenantId } });

  const [revenueAccts, expenseAccts] = await Promise.all([
    db.abAccount.findMany({ where: { tenantId, accountType: 'revenue' }, select: { id: true } }),
    db.abAccount.findMany({ where: { tenantId, accountType: 'expense' }, select: { id: true, name: true, taxCategory: true } }),
  ]);
  const revIds = revenueAccts.map((a) => a.id);

  const [revYtdAgg, revMonthAgg, ninetyDayExpenseAgg] = await Promise.all([
    revIds.length > 0
      ? db.abJournalLine.aggregate({
          where: { accountId: { in: revIds }, entry: { tenantId, date: { gte: yearStart } } },
          _sum: { creditCents: true, debitCents: true },
        })
      : Promise.resolve({ _sum: { creditCents: 0, debitCents: 0 } } as const),
    revIds.length > 0
      ? db.abJournalLine.aggregate({
          where: { accountId: { in: revIds }, entry: { tenantId, date: { gte: monthStart } } },
          _sum: { creditCents: true, debitCents: true },
        })
      : Promise.resolve({ _sum: { creditCents: 0, debitCents: 0 } } as const),
    db.abExpense.aggregate({
      where: { tenantId, isPersonal: false, date: { gte: ninetyDaysAgo } },
      _sum: { amountCents: true },
    }),
  ]);

  const ytdRevenueCents = (revYtdAgg._sum.creditCents || 0) - (revYtdAgg._sum.debitCents || 0);
  const monthlyRevenueCents = (revMonthAgg._sum.creditCents || 0) - (revMonthAgg._sum.debitCents || 0);
  const ninetyDayExpensesCents = ninetyDayExpenseAgg._sum.amountCents || 0;
  const monthlyBurnCents = Math.round(ninetyDayExpensesCents / 3);

  // Per-expense-account YTD for top-categories report
  const topCategoriesYtd: { category: string; amountCents: number }[] = [];
  let ytdExpensesCents = 0;
  for (const acct of expenseAccts) {
    const lines = await db.abJournalLine.findMany({
      where: { accountId: acct.id, entry: { tenantId, date: { gte: yearStart } } },
      select: { debitCents: true, creditCents: true },
    });
    const total = lines.reduce((s, l) => s + l.debitCents - l.creditCents, 0);
    if (total > 0) {
      topCategoriesYtd.push({ category: acct.name, amountCents: total });
      ytdExpensesCents += total;
    }
  }
  topCategoriesYtd.sort((a, b) => b.amountCents - a.amountCents);

  // Cash on hand from asset accounts
  const assetAccounts = await db.abAccount.findMany({
    where: { tenantId, accountType: 'asset', isActive: true },
    select: { journalLines: { select: { debitCents: true, creditCents: true } } },
  });
  const cashTodayCents = assetAccounts.reduce(
    (sum, a) => sum + a.journalLines.reduce((s, l) => s + l.debitCents - l.creditCents, 0),
    0,
  );

  // Outstanding invoices
  const outstandingInvoices = await db.abInvoice.findMany({
    where: { tenantId, status: { in: ['sent', 'viewed', 'overdue'] } },
    include: { payments: true },
  });
  const outstandingInvoiceCents = outstandingInvoices.reduce((s, inv) => {
    const paid = inv.payments.reduce((p, pay) => p + pay.amountCents, 0);
    return s + (inv.amountCents - paid);
  }, 0);
  const pastDueInvoiceCount = outstandingInvoices.filter((inv) => inv.dueDate < now).length;
  const upcomingInvoiceCents = outstandingInvoices
    .filter((inv) => inv.dueDate >= now)
    .reduce((s, inv) => {
      const paid = inv.payments.reduce((p, pay) => p + pay.amountCents, 0);
      return s + (inv.amountCents - paid);
    }, 0);

  // Recurring monthly outflows
  const recurringRules = await db.abRecurringRule.findMany({
    where: { tenantId, active: true },
    select: { amountCents: true, frequency: true },
  });
  const recurringMonthlyCents = recurringRules.reduce((s, r) => {
    const factor =
      r.frequency === 'weekly' ? 4.33 :
      r.frequency === 'biweekly' ? 2.17 :
      r.frequency === 'quarterly' ? 1 / 3 :
      r.frequency === 'annual' ? 1 / 12 :
      1; // monthly
    return s + Math.round(r.amountCents * factor);
  }, 0);

  // Tax deadline countdown
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
  const next = deadlines.find((d) => d > now);
  const taxDaysUntilQ = next ? Math.round((next.getTime() - now.getTime()) / 86_400_000) : null;
  const latestEstimate = await db.abTaxEstimate.findFirst({
    where: { tenantId },
    orderBy: { calculatedAt: 'desc' },
  });
  const taxQuarterlyEstimateCents = latestEstimate
    ? Math.ceil(latestEstimate.totalTaxCents / 4)
    : null;

  // Receipt coverage (business expenses YTD with receipt URLs / total)
  const [withReceipts, totalExpenses] = await Promise.all([
    db.abExpense.count({
      where: { tenantId, isPersonal: false, date: { gte: yearStart }, receiptUrl: { not: null } },
    }),
    db.abExpense.count({
      where: { tenantId, isPersonal: false, date: { gte: yearStart } },
    }),
  ]);
  const receiptCoveragePct = totalExpenses > 0 ? Math.round((withReceipts / totalExpenses) * 100) : 100;

  return {
    jurisdiction,
    cashTodayCents,
    monthlyBurnCents,
    monthlyRevenueCents,
    ytdRevenueCents,
    ytdExpensesCents,
    ytdNetIncomeCents: ytdRevenueCents - ytdExpensesCents,
    taxDaysUntilQ,
    taxQuarterlyEstimateCents,
    topCategoriesYtd: topCategoriesYtd.slice(0, 5),
    outstandingInvoiceCents,
    upcomingInvoiceCents,
    pastDueInvoiceCount,
    recurringMonthlyCents,
    receiptCoveragePct,
  };
}

function fmtUsd(cents: number): string {
  return '$' + Math.round(cents / 100).toLocaleString('en-US');
}

/**
 * Generate one tax-planning tip. Gemini first; a rule-based fallback
 * runs through the same context if the LLM is unavailable. Both paths
 * produce a single tip that names a specific number and ends with an
 * action.
 */
export async function generateTaxTip(ctx: TipContext): Promise<DigestTip | null> {
  const llm = await generateTipWithGemini('tax-planning', ctx);
  if (llm) return { text: llm, source: 'llm' };
  return generateTaxTipDeterministic(ctx);
}

export async function generateCashFlowTip(ctx: TipContext): Promise<DigestTip | null> {
  const llm = await generateTipWithGemini('cash-flow', ctx);
  if (llm) return { text: llm, source: 'llm' };
  return generateCashFlowTipDeterministic(ctx);
}

async function generateTipWithGemini(
  topic: 'tax-planning' | 'cash-flow',
  ctx: TipContext,
): Promise<string | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  const model = process.env.GEMINI_MODEL_FAST || 'gemini-2.0-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const systemPrompt = `You are a senior CPA writing a one-line tip for a freelancer's morning briefing.

RULES:
   • Maximum two sentences, total length ≤ 220 characters.
   • MUST reference at least one specific number from the context.
   • MUST end with a verb the reader can act on (e.g., "claim it",
     "chase the overdue", "set aside", "review").
   • NO generic platitudes ("save more!", "review your spending").
   • Plain text — no markdown, no asterisks, no emojis.
   • If there is genuinely nothing useful to say given the data,
     return the literal string "SKIP".

Topic: ${topic === 'tax-planning' ? 'tax planning (deductions, deadlines, withholding, brackets)' : 'cash flow (runway, AR, recurring outflows, near-term liquidity)'}

Tenant context:
${JSON.stringify(ctx, null, 2)}`;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: 'user', parts: [{ text: 'Generate the tip.' }] }],
        generationConfig: { maxOutputTokens: 200, temperature: 0.4 },
      }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    const raw = (data.candidates?.[0]?.content?.parts?.[0]?.text || '').trim();
    if (!raw || raw === 'SKIP') return null;
    // Reject anything that doesn't reference a number — tips must be
    // actionable, not generic.
    if (!/\d/.test(raw)) return null;
    return raw.replace(/^[*•\-]\s*/, '').trim();
  } catch {
    return null;
  }
}

function generateTaxTipDeterministic(ctx: TipContext): DigestTip | null {
  // Quarterly deadline takes priority when close.
  if (ctx.taxDaysUntilQ !== null && ctx.taxDaysUntilQ <= 21 && ctx.taxQuarterlyEstimateCents) {
    const cashCovers = ctx.cashTodayCents >= ctx.taxQuarterlyEstimateCents;
    const action = cashCovers ? 'set it aside today.' : 'start moving funds now.';
    return {
      text: `Quarterly estimated tax of ${fmtUsd(ctx.taxQuarterlyEstimateCents)} is due in ${ctx.taxDaysUntilQ} days. Cash on hand ${cashCovers ? 'covers it' : `(${fmtUsd(ctx.cashTodayCents)}) doesn't cover it yet`} — ${action}`,
      source: 'rule',
    };
  }

  // Meals deduction reminder (Schedule C line 24b — 50% deductible).
  const mealsCat = ctx.topCategoriesYtd.find((c) => /meals?/i.test(c.category));
  if (mealsCat && mealsCat.amountCents > 50_000) {
    const deductible = Math.round(mealsCat.amountCents * 0.5);
    return {
      text: `Meals YTD: ${fmtUsd(mealsCat.amountCents)} → ${fmtUsd(deductible)} deductible at the 50% rule. Document the business purpose on each receipt to lock it in.`,
      source: 'rule',
    };
  }

  // Receipt coverage gap.
  if (ctx.receiptCoveragePct < 80) {
    return {
      text: `Receipt coverage is at ${ctx.receiptCoveragePct}%. The IRS expects backup for any expense over $75 — sweep through "missing receipts" and snap photos before audit season.`,
      source: 'rule',
    };
  }

  // Net income running high — withholding nudge.
  if (ctx.ytdNetIncomeCents > 5_000_000) {
    const setAside = Math.round(ctx.ytdNetIncomeCents * 0.27);
    return {
      text: `Net income YTD is ${fmtUsd(ctx.ytdNetIncomeCents)}. Plan to set aside ~27% (≈ ${fmtUsd(setAside)}) for federal + SE tax — confirm your quarterly is on track.`,
      source: 'rule',
    };
  }

  return null;
}

function generateCashFlowTipDeterministic(ctx: TipContext): DigestTip | null {
  // Runway warning.
  if (ctx.monthlyBurnCents > 0) {
    const months = ctx.cashTodayCents / ctx.monthlyBurnCents;
    if (months < 2) {
      return {
        text: `Cash on hand ${fmtUsd(ctx.cashTodayCents)} = ${months.toFixed(1)} months at current burn (${fmtUsd(ctx.monthlyBurnCents)}/mo). ${ctx.outstandingInvoiceCents > 0 ? `Chase ${fmtUsd(ctx.outstandingInvoiceCents)} in outstanding AR to extend runway.` : 'Cut a recurring or accelerate AR to extend runway.'}`,
        source: 'rule',
      };
    }
  }

  // Past-due invoices.
  if (ctx.pastDueInvoiceCount > 0) {
    return {
      text: `${ctx.pastDueInvoiceCount} invoice${ctx.pastDueInvoiceCount === 1 ? '' : 's'} past due — that's ${fmtUsd(ctx.outstandingInvoiceCents - ctx.upcomingInvoiceCents)} you've already earned. Send a reminder today.`,
      source: 'rule',
    };
  }

  // High recurring share.
  if (ctx.recurringMonthlyCents > 0 && ctx.monthlyBurnCents > 0) {
    const pct = Math.round((ctx.recurringMonthlyCents / ctx.monthlyBurnCents) * 100);
    if (pct >= 40) {
      return {
        text: `Recurring outflows are ${fmtUsd(ctx.recurringMonthlyCents)}/mo — ${pct}% of total burn. Review for unused subscriptions you can cancel.`,
        source: 'rule',
      };
    }
  }

  // Healthy cash but inactive AR push.
  if (ctx.upcomingInvoiceCents > 0 && ctx.upcomingInvoiceCents > ctx.cashTodayCents) {
    return {
      text: `${fmtUsd(ctx.upcomingInvoiceCents)} in invoices comes due over the next 30 days — confirm with the biggest clients that they're on track to pay.`,
      source: 'rule',
    };
  }

  return null;
}
