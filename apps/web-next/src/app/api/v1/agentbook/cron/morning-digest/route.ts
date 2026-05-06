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

function composeMessage(name: string, d: DigestData, ai: AutoCategoryResult): string {
  const lines: string[] = [];
  lines.push(`☀️ <b>Morning, ${escapeHtml(name)}</b>`);
  lines.push('');
  lines.push(`💰 Cash on hand: <b>${fmt$(d.cashTodayCents)}</b>`);

  if (d.yesterday.paymentCount > 0 || d.yesterday.expenseCount > 0) {
    const sign = d.yesterday.netCents >= 0 ? '+' : '';
    lines.push(
      `📊 Yesterday: ${sign}${fmt$(d.yesterday.netCents)} (${d.yesterday.paymentCount} payment${d.yesterday.paymentCount === 1 ? '' : 's'} in / ${d.yesterday.expenseCount} expense${d.yesterday.expenseCount === 1 ? '' : 's'} out)`,
    );
  }

  if (d.pendingReviewCount > 0) {
    lines.push(`⚠️  <b>${d.pendingReviewCount}</b> draft expense${d.pendingReviewCount === 1 ? '' : 's'} waiting for review`);
  }

  // Auto-categorizer summary (gap: daily routine + batched review).
  if (ai.appliedCount > 0 || ai.pending.length > 0) {
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

  if (d.attention.length > 0) {
    lines.push('');
    lines.push(`🚨 <b>Overdue invoices</b>`);
    for (const a of d.attention.slice(0, 3)) {
      lines.push(`  • ${escapeHtml(a.title)}${a.amountCents ? ' — ' + fmt$(a.amountCents) : ''}`);
    }
    if (d.attention.length > 3) lines.push(`  … and ${d.attention.length - 3} more`);
  }

  if (d.upcomingThisWeek.length > 0) {
    lines.push('');
    lines.push(`📅 <b>This week</b>`);
    for (const u of d.upcomingThisWeek.slice(0, 4)) {
      const arrow = u.kind === 'income' ? '↗' : '↘';
      lines.push(`  ${arrow} ${escapeHtml(u.label)} — ${fmt$(u.amountCents)} in ${u.daysOut}d`);
    }
  }

  if (d.anomalyCount > 0) {
    lines.push('');
    lines.push(`📈 ${d.anomalyCount} unusual expense${d.anomalyCount === 1 ? '' : 's'} yesterday — type "expenses" to review`);
  }

  if (d.taxDaysUntilQ !== null && d.taxDaysUntilQ <= 21) {
    lines.push('');
    lines.push(`📋 <b>Quarterly tax due in ${d.taxDaysUntilQ} days</b> — type "tax" for the estimate`);
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
      const fmtH = new Intl.DateTimeFormat('en-US', {
        hour: 'numeric',
        hour12: false,
        timeZone: tenant.timezone || 'America/New_York',
      });
      const localHour = parseInt(fmtH.format(now), 10);
      // Allow on-demand testing via ?hour=now to bypass the time gate.
      const bypass = targetParam === 'now';
      if (!bypass && localHour !== targetHour) {
        skipped++;
        continue;
      }

      // Run the daily auto-categorizer first so its results show up in
      // today's digest. The helper short-circuits if it already ran today.
      const ai = await autoCategorizeForTenant(tenant.userId);

      const digest = await buildDigest(tenant.userId);
      const user = await db.user.findUnique({ where: { id: tenant.userId } });
      const name = user?.displayName?.split(' ')[0] || 'there';

      const message = composeMessage(name, digest, ai);
      // Review button covers BOTH queues — AI suggestions AND uncategorized
      // draft expenses. The unified review batch handler walks through both.
      const reviewCount = ai.pending.length + digest.pendingReviewCount;
      const keyboard = reviewCount > 0
        ? [[{ text: `👀 Review ${reviewCount} item${reviewCount === 1 ? '' : 's'}`, callback_data: 'review_drafts' }]]
        : undefined;
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
