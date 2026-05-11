/**
 * Insightful daily-briefing builder.
 *
 * The morning-digest cron used to render a long flat list of sections.
 * This module adds three structured layers around it:
 *   1. buildHeader      — date + day-of-week + greeting, in tenant TZ
 *   2. buildHighlights  — opinionated 1-3 must-know bullets
 *   3. buildSnapshot    — 3-line quick-glance state (cash / AR / MTD)
 *   4. buildTodos       — prioritized, deduped action list (capped at 6)
 *
 * Each helper is pure and depends only on the digest data + tenant TZ.
 * The cron route still owns DB I/O; this module owns the rendering and
 * the prioritization logic so it's unit-testable in isolation.
 */

import 'server-only';

// ─── Types (mirror the cron's DigestData / aux types) ────────────────────

export interface DigestSnapshot {
  cashTodayCents: number;
  cashYesterdayCents: number;       // for the day-over-day delta
  arTotalCents: number;
  arInvoiceCount: number;
  mtdSpendCents: number;            // month-to-date business expenses (confirmed)
  mtdBudgetTotalCents: number | null; // sum of monthly budget caps; null if no budgets
}

export interface DigestYesterday {
  paymentsInCents: number;
  expensesOutCents: number;
  netCents: number;
  paymentCount: number;
  expenseCount: number;
}

export interface DigestAttention {
  kind: string;
  title: string;
  amountCents?: number;
  daysPastDue?: number;
}

export interface DigestUpcoming {
  kind: 'income' | 'outflow';
  label: string;
  daysOut: number;
  amountCents: number;
}

export interface DigestBankReview {
  count: number;
  items: Array<{ amountCents: number; merchantName: string | null }>;
}

export interface DigestMissingReceipts {
  count: number;
  items: Array<{ description: string | null; vendorName: string | null; amountCents: number; daysOld: number }>;
}

export interface DigestCpaRequest {
  id: string;
  message: string;
}

export interface DigestDeduction {
  id: string;
  message: string | null;
}

export interface DigestAutoCategorize {
  appliedCount: number;
  pendingCount: number;
}

export interface DigestBudgetHot {
  categoryName: string | null;
  spentCents: number;
  limitCents: number;
  percent: number;
}

export interface DigestSummary {
  snapshot: DigestSnapshot;
  yesterday: DigestYesterday;
  pendingReviewCount: number;
  attention: DigestAttention[];
  upcoming: DigestUpcoming[];
  anomalyCount: number;
  taxDaysUntilQ: number | null;
  taxQEstimateCents: number | null;
  bankReview: DigestBankReview;
  missingReceipts: DigestMissingReceipts;
  cpaRequests: DigestCpaRequest[];
  deductions: DigestDeduction[];
  hotBudgets: DigestBudgetHot[];
  ai: DigestAutoCategorize;
}

// ─── Header ──────────────────────────────────────────────────────────────

/**
 * Render a header line + salutation in the tenant's timezone.
 *
 *   "🌅 <b>Friday, May 9</b> · 6:00am\n"
 *   "Morning, Maya 👋\n"
 *
 * The salutation switches with local hour: Morning <12, Afternoon 12-16,
 * Evening 17-23, Night 0-4. Default 'Morning' if the cron fires at the
 * usual pre-7am window.
 */
export function buildHeader(opts: { tenantTimezone: string; name: string; now?: Date }): string {
  const now = opts.now ?? new Date();
  const tz = opts.tenantTimezone || 'America/New_York';

  const dateFmt = new Intl.DateTimeFormat('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', timeZone: tz,
  });
  const timeFmt = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric', minute: '2-digit', hour12: true, timeZone: tz,
  });
  const hourFmt = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric', hour12: false, timeZone: tz,
  });

  const dateStr = dateFmt.format(now);              // "Friday, May 9"
  const timeStr = timeFmt.format(now).toLowerCase().replace(/\s/g, '');  // "6:00am"
  const localHour = parseInt(hourFmt.format(now), 10);

  let icon: string;
  let salutation: string;
  if (localHour < 5) { icon = '🌙'; salutation = 'Late night'; }
  else if (localHour < 12) { icon = '🌅'; salutation = 'Morning'; }
  else if (localHour < 17) { icon = '☀️'; salutation = 'Afternoon'; }
  else { icon = '🌆'; salutation = 'Evening'; }

  const safeName = escapeHtml(opts.name);
  return `${icon} <b>${dateStr}</b> · ${timeStr}\n${salutation}, ${safeName} 👋`;
}

// ─── Highlights ──────────────────────────────────────────────────────────

/**
 * Opinionated 1-3 must-know bullets from the day's data. Each highlight
 * is a single line that combines a number + a why-it-matters reason.
 *
 * Priority order (only top 3 surface):
 *   1. Big incoming payment yesterday (>= $1,000)
 *   2. Severe overdue clusters (≥ 2 invoices >30d late)
 *   3. Imminent tax/cash-flow risk (≤14d to deadline)
 *   4. Large uncategorized review queue (≥ 5 pending)
 *   5. Yesterday's net flow if substantial (≥ $500 or ≤ -$500)
 *   6. Hot budget about to overflow (≥ 95%)
 */
export function buildHighlights(s: DigestSummary): string[] {
  const items: { priority: number; line: string }[] = [];

  // 1. Big payment in
  if (s.yesterday.paymentsInCents >= 100_000) {
    items.push({
      priority: 1,
      line: `<b>${fmtMoney(s.yesterday.paymentsInCents)}</b> landed yesterday — AR is now ${fmtMoney(s.snapshot.arTotalCents)} across ${s.snapshot.arInvoiceCount} invoice${s.snapshot.arInvoiceCount === 1 ? '' : 's'}.`,
    });
  }

  // 2. Severe overdue cluster
  const veryLate = s.attention.filter((a) => (a.daysPastDue ?? 0) >= 30);
  if (veryLate.length >= 2) {
    const total = veryLate.reduce((sum, a) => sum + (a.amountCents ?? 0), 0);
    items.push({
      priority: 2,
      line: `<b>${veryLate.length} invoices &gt;30d late</b> — ${fmtMoney(total)} stuck. Send reminders.`,
    });
  } else if (veryLate.length === 1 && (veryLate[0].amountCents ?? 0) >= 100_000) {
    items.push({
      priority: 2,
      line: `<b>${escapeHtml(veryLate[0].title)}</b> is ${veryLate[0].daysPastDue}d late (${fmtMoney(veryLate[0].amountCents ?? 0)}).`,
    });
  }

  // 3. Tax deadline imminent
  if (s.taxDaysUntilQ !== null && s.taxDaysUntilQ <= 14) {
    const est = s.taxQEstimateCents != null ? ` (~${fmtMoney(s.taxQEstimateCents)})` : '';
    const word = s.taxDaysUntilQ <= 0 ? 'today' : s.taxDaysUntilQ === 1 ? 'tomorrow' : `in ${s.taxDaysUntilQ}d`;
    items.push({
      priority: 3,
      line: `<b>Quarterly tax due ${word}</b>${est} — type "tax" to file.`,
    });
  }

  // 4. Big review queue
  const reviewBacklog = s.pendingReviewCount + s.ai.pendingCount;
  if (reviewBacklog >= 5) {
    items.push({
      priority: 4,
      line: `<b>${reviewBacklog} expenses</b> pending your eyes — clearing them keeps the books clean.`,
    });
  }

  // 5. Big day flow
  if (Math.abs(s.yesterday.netCents) >= 50_000 && s.yesterday.paymentsInCents < 100_000) {
    const sign = s.yesterday.netCents >= 0 ? 'up' : 'down';
    items.push({
      priority: 5,
      line: `Yesterday closed <b>${sign} ${fmtMoney(Math.abs(s.yesterday.netCents))}</b> (${s.yesterday.paymentCount} in / ${s.yesterday.expenseCount} out).`,
    });
  }

  // 6. Hot budget about to overflow
  const overflowing = s.hotBudgets.find((b) => b.percent >= 95);
  if (overflowing) {
    items.push({
      priority: 6,
      line: `<b>${escapeHtml(overflowing.categoryName || 'Total')}</b> budget at <b>${overflowing.percent}%</b> (${fmtMoney(overflowing.spentCents)}/${fmtMoney(overflowing.limitCents)}).`,
    });
  }

  // Pick top 3 by priority
  items.sort((a, b) => a.priority - b.priority);
  return items.slice(0, 3).map((i) => i.line);
}

// ─── Snapshot ────────────────────────────────────────────────────────────

/**
 * Three-line quick-glance state of the books.
 *
 *   💰 Cash: $5,840 (▲ $1,200 from yesterday)
 *   🏦 AR: $4,300 across 3 invoices
 *   📈 May spend: $2,140 / $3,500 budget (61%)
 *
 * If no budgets are set, the third line shows MTD spend without a target.
 */
export function buildSnapshot(s: DigestSummary, opts: { tenantTimezone: string; now?: Date }): string[] {
  const now = opts.now ?? new Date();
  const tz = opts.tenantTimezone || 'America/New_York';
  const lines: string[] = [];

  // Cash + day-over-day
  const delta = s.snapshot.cashTodayCents - s.snapshot.cashYesterdayCents;
  let cashLine = `💰 Cash: <b>${fmtMoney(s.snapshot.cashTodayCents)}</b>`;
  if (Math.abs(delta) >= 100) {
    const arrow = delta >= 0 ? '▲' : '▼';
    cashLine += ` (${arrow} ${fmtMoney(Math.abs(delta))} from yesterday)`;
  }
  lines.push(cashLine);

  // AR
  if (s.snapshot.arTotalCents > 0) {
    lines.push(
      `🏦 AR: <b>${fmtMoney(s.snapshot.arTotalCents)}</b> across ${s.snapshot.arInvoiceCount} invoice${s.snapshot.arInvoiceCount === 1 ? '' : 's'}`,
    );
  }

  // MTD spend vs budget
  const monthFmt = new Intl.DateTimeFormat('en-US', { month: 'long', timeZone: tz });
  const monthName = monthFmt.format(now);
  if (s.snapshot.mtdBudgetTotalCents && s.snapshot.mtdBudgetTotalCents > 0) {
    const pct = Math.round((s.snapshot.mtdSpendCents / s.snapshot.mtdBudgetTotalCents) * 100);
    lines.push(
      `📈 ${monthName} spend: <b>${fmtMoney(s.snapshot.mtdSpendCents)}</b> / ${fmtMoney(s.snapshot.mtdBudgetTotalCents)} budget (${pct}%)`,
    );
  } else if (s.snapshot.mtdSpendCents > 0) {
    lines.push(`📈 ${monthName} spend so far: <b>${fmtMoney(s.snapshot.mtdSpendCents)}</b>`);
  }

  return lines;
}

// ─── TODOs ───────────────────────────────────────────────────────────────

/**
 * Prioritized, deduped action list. Capped at 6 items so the section
 * stays glance-able. Each item is a numbered single line: emoji + verb +
 * count/amount + a tap/reply hint.
 *
 * Priority order:
 *   1. CPA requests (someone is waiting for a reply)
 *   2. Tax deadline ≤7 days
 *   3. Bank reconciliation matches needed
 *   4. Pending review drafts
 *   5. Auto-categorize pending check
 *   6. Apply/skip smart deduction suggestions
 *   7. Send/skip missing receipts
 *   8. Send overdue invoice reminder
 *   9. Recommended bookkeeping nudges (high-budget)
 */
export function buildTodos(s: DigestSummary): string[] {
  const items: { priority: number; line: string }[] = [];

  if (s.cpaRequests.length > 0) {
    items.push({
      priority: 1,
      line: `📒 Reply to your CPA — <b>${s.cpaRequests.length}</b> open question${s.cpaRequests.length === 1 ? '' : 's'} waiting`,
    });
  }

  if (s.taxDaysUntilQ !== null && s.taxDaysUntilQ <= 7) {
    const word = s.taxDaysUntilQ <= 0 ? 'today' : s.taxDaysUntilQ === 1 ? 'tomorrow' : `in ${s.taxDaysUntilQ}d`;
    items.push({
      priority: 2,
      line: `📋 File quarterly tax ${word} — type <code>tax</code>`,
    });
  }

  if (s.bankReview.count > 0) {
    items.push({
      priority: 3,
      line: `🏦 Match <b>${s.bankReview.count}</b> bank transaction${s.bankReview.count === 1 ? '' : 's'} — tap ✅ on each msg below`,
    });
  }

  if (s.pendingReviewCount > 0) {
    items.push({
      priority: 4,
      line: `⚠️ Review <b>${s.pendingReviewCount}</b> draft expense${s.pendingReviewCount === 1 ? '' : 's'} — type <code>review</code>`,
    });
  }

  if (s.ai.pendingCount > 0) {
    items.push({
      priority: 5,
      line: `🤔 Confirm <b>${s.ai.pendingCount}</b> auto-categorized expense${s.ai.pendingCount === 1 ? '' : 's'} — tap below`,
    });
  }

  if (s.deductions.length > 0) {
    items.push({
      priority: 6,
      line: `💡 Apply or skip <b>${s.deductions.length}</b> deduction suggestion${s.deductions.length === 1 ? '' : 's'} — tap each msg`,
    });
  }

  if (s.missingReceipts.count > 0) {
    items.push({
      priority: 7,
      line: `📸 Send or skip receipts for <b>${s.missingReceipts.count}</b> expense${s.missingReceipts.count === 1 ? '' : 's'} (>14d old)`,
    });
  }

  // Overdue follow-up — only when there's at least one substantially-late
  // invoice ($100+, >7 days). Avoids nagging on $20 things or 1-day blips.
  const overdueWorth = s.attention.filter(
    (a) => (a.amountCents ?? 0) >= 10_000 && (a.daysPastDue ?? 0) >= 7,
  );
  if (overdueWorth.length > 0) {
    items.push({
      priority: 8,
      line: `🚨 Send reminder for <b>${overdueWorth.length}</b> overdue invoice${overdueWorth.length === 1 ? '' : 's'} — type <code>send reminders</code>`,
    });
  }

  if (s.taxDaysUntilQ !== null && s.taxDaysUntilQ > 7 && s.taxDaysUntilQ <= 21) {
    const est = s.taxQEstimateCents != null ? ` (~${fmtMoney(s.taxQEstimateCents)})` : '';
    items.push({
      priority: 9,
      line: `📋 Set aside for quarterly tax in ${s.taxDaysUntilQ}d${est}`,
    });
  }

  items.sort((a, b) => a.priority - b.priority);
  // Render with numbered prefix
  return items.slice(0, 6).map((i, idx) => `${idx + 1}. ${i.line}`);
}

// ─── Helpers ─────────────────────────────────────────────────────────────

function fmtMoney(cents: number): string {
  // Cents → "$X,XXX". Round to whole dollars; the digest favors glance-ability
  // over penny-precision (penny totals appear inside detail sections and on
  // ledger pages, not in the morning digest).
  return '$' + Math.round(cents / 100).toLocaleString('en-US');
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
