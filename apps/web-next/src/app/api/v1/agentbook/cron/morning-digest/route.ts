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

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

interface DigestData {
  cashTodayCents: number;
  yesterday: {
    paymentsInCents: number;
    expensesOutCents: number;
    netCents: number;
    paymentCount: number;
    expenseCount: number;
  };
  pendingReviewCount: number;
  attention: { kind: string; title: string; amountCents?: number }[];
  upcomingThisWeek: { kind: string; label: string; daysOut: number; amountCents: number }[];
  anomalyCount: number;
  taxDaysUntilQ: number | null;
}

function fmt$(cents: number): string {
  return '$' + Math.round(cents / 100).toLocaleString('en-US');
}

async function buildDigest(tenantId: string): Promise<DigestData> {
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
    };
  });

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

  return {
    cashTodayCents,
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
  };
}

function composeMessage(
  name: string,
  d: DigestData,
  ai: AutoCategoryResult,
  prefs: DigestPrefs,
  tips: { tax?: string | null; cashFlow?: string | null },
): string {
  const concise = prefs.tone === 'concise';
  const sec = prefs.sections;
  const lines: string[] = [];
  lines.push(`☀️ <b>Morning, ${escapeHtml(name)}</b>`);
  lines.push('');

  if (sec.cashOnHand) {
    lines.push(`💰 Cash on hand: <b>${fmt$(d.cashTodayCents)}</b>`);
  }

  if (sec.yesterday && (d.yesterday.paymentCount > 0 || d.yesterday.expenseCount > 0)) {
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

  if (sec.taxDeadline && d.taxDaysUntilQ !== null && d.taxDaysUntilQ <= 21) {
    lines.push('');
    lines.push(`📋 <b>Quarterly tax due in ${d.taxDaysUntilQ} days</b> — type "tax" for the estimate`);
  }

  if (sec.taxTips && tips.tax) {
    lines.push('');
    lines.push(`💡 <b>Tax tip:</b> ${escapeHtml(tips.tax)}`);
  }

  if (sec.cashFlowTips && tips.cashFlow) {
    lines.push('');
    lines.push(`🌊 <b>Cash flow:</b> ${escapeHtml(tips.cashFlow)}`);
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

      const message = composeMessage(name, digest, ai, prefs, { tax: taxTip, cashFlow: cashFlowTip });
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
