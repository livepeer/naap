/**
 * Telegram Bot Webhook.
 *
 * Self-contained: tenant resolution and the minimal agent both run
 * against Prisma directly. The full Express agent-brain pipeline
 * (memory, planner, evaluator, 16 skills, Gemini) is not bundled
 * into this Vercel function — instead we pattern-match the common
 * queries (balance, invoices, expenses, tax) so the bot is
 * responsive for daily testing.
 */
import { NextRequest, NextResponse } from 'next/server';
import { Bot } from 'grammy';
import { prisma as db } from '@naap/database';

// Dev fallback: hardcoded chat ID → tenant mapping
const CHAT_TO_TENANT_FALLBACK: Record<string, string> = {
  '5336658682': '2e2348b6-a64c-44ad-907e-4ac120ff06f2', // Qiang → Maya
  '555555555':  'b9a80acd-fa14-4209-83a9-03231513fa8f', // Nightly e2e bot tests → e2e@agentbook.test
};

// === E2E test capture ===
//
// When E2E_TELEGRAM_CAPTURE=1, intercept bot.api.sendMessage so the
// nightly suite can inspect would-be replies without hitting Telegram.
// Production behaviour is unchanged when the env var is unset.

interface CaptureEntry { chatId: number | string; text: string; payload?: unknown; }
const E2E_CAPTURE = process.env.E2E_TELEGRAM_CAPTURE === '1';
let currentCapture: CaptureEntry[] | null = null;

/** Resolve tenant from chat ID via direct DB lookup, then fallback map. */
async function resolveTenantId(chatId: number, botToken?: string): Promise<string> {
  const chatStr = String(chatId);

  try {
    let bot: { id: string; tenantId: string; chatIds: unknown } | null = null;
    if (botToken) {
      bot = await db.abTelegramBot.findFirst({ where: { botToken, enabled: true } });
    }
    if (!bot) {
      const allBots = await db.abTelegramBot.findMany({ where: { enabled: true } });
      bot = allBots.find((b) => {
        const ids = (b.chatIds as string[]) || [];
        return ids.includes(chatStr);
      }) || null;
    }
    if (bot) {
      const ids = (bot.chatIds as string[]) || [];
      if (!ids.includes(chatStr)) {
        ids.push(chatStr);
        await db.abTelegramBot.update({ where: { id: bot.id }, data: { chatIds: ids as never } });
      }
      return bot.tenantId;
    }
  } catch (err) {
    console.warn('[telegram] DB tenant lookup failed:', err);
  }

  if (CHAT_TO_TENANT_FALLBACK[chatStr]) return CHAT_TO_TENANT_FALLBACK[chatStr];
  console.warn(`Unknown Telegram chat ${chatStr} — no tenant mapping found`);
  return `unmapped:${chatStr}`;
}

function fmtUsd(cents: number): string {
  return '$' + (Math.abs(cents) / 100).toLocaleString('en-US', { maximumFractionDigits: 2, minimumFractionDigits: 2 });
}

/** Minimal in-process agent — pattern-matches common queries against the tenant's books. */
async function callAgentBrain(
  tenantId: string,
  text: string,
  _attachments?: { type: string; url: string }[],
  sessionAction?: string,
  _feedback?: string,
): Promise<{ success: true; data: { message: string; skillUsed?: string } } | { success: false; error: string }> {
  if (sessionAction) {
    return { success: true, data: { message: 'Session-based actions (yes/no/undo) require the full agent brain, which isn\'t enabled in this build yet. Try a direct query: balance, invoices, expenses, tax.' } };
  }

  const lower = text.toLowerCase().trim();

  try {
    if (/(balance|cash|how much.*(have|in the bank))/i.test(lower)) {
      const accounts = await db.abAccount.findMany({
        where: { tenantId, accountType: 'asset', isActive: true },
        select: { name: true, journalLines: { select: { debitCents: true, creditCents: true } } },
      });
      const total = accounts.reduce((sum, a) => sum + a.journalLines.reduce((s, l) => s + l.debitCents - l.creditCents, 0), 0);
      const lines = accounts
        .map((a) => ({ name: a.name, bal: a.journalLines.reduce((s, l) => s + l.debitCents - l.creditCents, 0) }))
        .filter((a) => a.bal !== 0)
        .slice(0, 5);
      const detail = lines.length ? '\n\n' + lines.map((l) => `• ${l.name}: ${fmtUsd(l.bal)}`).join('\n') : '';
      return { success: true, data: { message: `💰 <b>Cash on hand:</b> ${fmtUsd(total)}${detail}`, skillUsed: 'query-finance' } };
    }

    if (/(invoice|owed|outstanding|unpaid|who owes)/i.test(lower)) {
      const open = await db.abInvoice.findMany({
        where: { tenantId, status: { in: ['sent', 'viewed', 'overdue'] } },
        include: { client: { select: { name: true } } },
        orderBy: { dueDate: 'asc' },
        take: 8,
      });
      if (open.length === 0) {
        return { success: true, data: { message: '🧾 No outstanding invoices.', skillUsed: 'query-finance' } };
      }
      const total = open.reduce((s, i) => s + i.amountCents, 0);
      const today = Date.now();
      const list = open.map((i) => {
        const days = Math.round((today - i.dueDate.getTime()) / 86_400_000);
        const tag = days > 0 ? ` · ${days}d overdue` : days < 0 ? ` · due in ${-days}d` : ' · due today';
        return `• ${i.client?.name || 'Client'} ${i.number} — ${fmtUsd(i.amountCents)}${tag}`;
      }).join('\n');
      return { success: true, data: { message: `🧾 <b>${open.length} open invoice${open.length === 1 ? '' : 's'}</b> — total ${fmtUsd(total)}\n\n${list}`, skillUsed: 'query-finance' } };
    }

    if (/(expense|spent|spending|recent.*(expense|spend))/i.test(lower)) {
      const recent = await db.abExpense.findMany({
        where: { tenantId, isPersonal: false },
        include: { vendor: { select: { name: true } } },
        orderBy: { date: 'desc' },
        take: 5,
      });
      if (recent.length === 0) {
        return { success: true, data: { message: '💸 No business expenses on record yet. Send "Spent $X on Y" to add one.', skillUsed: 'query-expenses' } };
      }
      const list = recent.map((e) => `• ${e.date.toISOString().slice(0, 10)} — ${e.vendor?.name || e.description || 'Expense'} ${fmtUsd(e.amountCents)}`).join('\n');
      return { success: true, data: { message: `💸 <b>Last ${recent.length} expense${recent.length === 1 ? '' : 's'}:</b>\n\n${list}`, skillUsed: 'query-expenses' } };
    }

    if (/(tax|owe.*(cra|irs|government))/i.test(lower)) {
      const tenantConfig = await db.abTenantConfig.findUnique({ where: { userId: tenantId } });
      const jurisdiction = tenantConfig?.jurisdiction || 'us';
      const yearStart = new Date(new Date().getFullYear(), 0, 1);
      const [revAccts, expAccts] = await Promise.all([
        db.abAccount.findMany({ where: { tenantId, accountType: 'revenue', isActive: true }, select: { id: true } }),
        db.abAccount.findMany({ where: { tenantId, accountType: 'expense', isActive: true }, select: { id: true } }),
      ]);
      const [revAgg, expAgg] = await Promise.all([
        revAccts.length ? db.abJournalLine.aggregate({
          where: { accountId: { in: revAccts.map((a) => a.id) }, entry: { tenantId, date: { gte: yearStart } } },
          _sum: { creditCents: true, debitCents: true },
        }) : Promise.resolve({ _sum: { creditCents: 0, debitCents: 0 } }),
        expAccts.length ? db.abJournalLine.aggregate({
          where: { accountId: { in: expAccts.map((a) => a.id) }, entry: { tenantId, date: { gte: yearStart } } },
          _sum: { creditCents: true, debitCents: true },
        }) : Promise.resolve({ _sum: { creditCents: 0, debitCents: 0 } }),
      ]);
      const gross = (revAgg._sum.creditCents || 0) - (revAgg._sum.debitCents || 0);
      const exp = (expAgg._sum.debitCents || 0) - (expAgg._sum.creditCents || 0);
      const net = gross - exp;
      const seTax = net <= 0 ? 0 : jurisdiction === 'ca' ? Math.round(net * 0.119) : Math.round(net * 0.9235 * 0.153);
      const taxableUS = Math.max(0, net - Math.round(seTax / 2));
      const incomeTax = jurisdiction === 'ca'
        ? Math.round(Math.max(0, net) * 0.205)
        : Math.round(taxableUS * 0.22);
      const total = seTax + incomeTax;
      return { success: true, data: { message: `🧾 <b>YTD tax estimate (${jurisdiction.toUpperCase()})</b>\n\n• Revenue: ${fmtUsd(gross)}\n• Expenses: ${fmtUsd(exp)}\n• Net income: ${fmtUsd(net)}\n• ${jurisdiction === 'ca' ? 'CPP' : 'SE tax'}: ${fmtUsd(seTax)}\n• Income tax: ${fmtUsd(incomeTax)}\n• <b>Total: ${fmtUsd(total)}</b>`, skillUsed: 'query-finance' } };
    }

    return {
      success: true,
      data: {
        message: 'I can help with a few things directly:\n\n• <b>"balance"</b> — cash on hand\n• <b>"invoices"</b> — who owes you\n• <b>"expenses"</b> — recent spending\n• <b>"tax"</b> — YTD tax estimate\n\nThe full conversational agent (record-expense, scan-receipt, planning) needs the agent-brain pipeline, which isn\'t enabled in this build yet.',
      },
    };
  } catch (err) {
    console.error('[telegram/agent] failed:', err);
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Escape HTML special characters for Telegram. */
function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Convert markdown to Telegram-safe HTML. */
function mdToHtml(md: string): string {
  // Escape HTML entities first, then apply formatting
  let html = escHtml(md);
  html = html.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
  html = html.replace(/\*(.+?)\*/g, '<i>$1</i>');
  html = html.replace(/`(.+?)`/g, '<code>$1</code>');
  return html;
}

/** Format agent response for Telegram. */
function formatResponse(data: any): string {
  let reply = mdToHtml(data.message || 'Done.');
  if (data.chartData?.data?.length) {
    reply += '\n\n📊 <b>Breakdown:</b>';
    for (const item of data.chartData.data.slice(0, 8)) {
      const val = typeof item.value === 'number' && item.value > 100
        ? '$' + (item.value / 100).toLocaleString()
        : item.value;
      reply += `\n• ${item.name}: ${val}`;
    }
  }
  return reply;
}

// Lazy-initialize bot (cold start optimization for serverless)
let bot: Bot | null = null;

function getBot(): Bot {
  if (bot) return bot;

  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN not set');

  bot = new Bot(token);

  if (E2E_CAPTURE) {
    const orig = bot.api.sendMessage.bind(bot.api);
    // Override the raw sendMessage so all ctx.reply() / ctx.replyWithHTML / etc.
    // funnel through here. Push to currentCapture if set, otherwise call through
    // (e.g. for direct sendMessage in production paths).
    (bot.api as any).sendMessage = (async (chatId: number | string, text: string, payload?: unknown) => {
      if (currentCapture) {
        currentCapture.push({ chatId, text, payload });
        // Return a fake Telegram Message object so grammy doesn't choke.
        return { message_id: 0, date: Math.floor(Date.now() / 1000), chat: { id: Number(chatId), type: 'private' as const }, text } as any;
      }
      return orig(chatId, text, payload as any);
    });
  }

  // === Text messages → Agent Brain ===
  bot.on('message:text', async (ctx) => {
    const text = ctx.message.text;
    const tenantId = await resolveTenantId(ctx.chat.id);

    // Commands that show static help text
    if (text === '/start') {
      await ctx.reply('👋 Welcome to <b>AgentBook</b>!\n\nI\'m your AI accounting agent. Here\'s what I can do:\n\n💬 <b>Record expenses:</b> "Spent $45 on lunch at Starbucks"\n📸 <b>Snap receipts:</b> Send a photo or PDF\n❓ <b>Ask anything:</b> "How much on travel this month?"\n📊 <b>Get insights:</b> "Show me spending breakdown"\n💰 <b>Check balance:</b> "What\'s my cash balance?"\n🧾 <b>Invoicing:</b> "Invoice Acme $5000 for consulting"\n\n/help for all commands', { parse_mode: 'HTML' });
      return;
    }
    if (text === '/help' || text === '/help@Agentbookdev_bot') {
      await ctx.reply(
        '📚 <b>AgentBook — What I Can Do</b>\n\n'
        + 'Just type naturally — I\'ll figure it out. Or use /help [topic] for details:\n\n'
        + '/help expenses — record, query, categorize\n'
        + '/help invoices — create, send, track payments\n'
        + '/help tax — estimates, deductions, filing\n'
        + '/help reports — P&amp;L, balance sheet, cashflow\n'
        + '/help timer — time tracking &amp; billing\n'
        + '/help planning — multi-step tasks &amp; automation\n'
        + '/help telegram — connect your own bot\n\n'
        + '<b>Quick examples:</b>\n'
        + '• "Spent $45 on lunch at Starbucks"\n'
        + '• "Show my invoices"\n'
        + '• "How much tax do I owe?"\n'
        + '• Send a receipt photo or tax slip\n'
        + '• "Start my tax filing"',
        { parse_mode: 'HTML' },
      );
      return;
    }

    // Topic-specific help
    const helpMatch = text.match(/^\/help\s+(\w+)/i);
    if (helpMatch) {
      const topic = helpMatch[1].toLowerCase();
      const helpTopics: Record<string, string> = {
        expenses:
          '💰 <b>Expenses</b>\n\n'
          + '<b>Record:</b>\n'
          + '• "Spent $45 on lunch at Starbucks"\n'
          + '• "Paid $99 for GitHub subscription"\n'
          + '• Send a receipt photo — I\'ll OCR it\n\n'
          + '<b>Query:</b>\n'
          + '• "Show last 5 expenses"\n'
          + '• "How much on travel this month?"\n'
          + '• "Top spending categories"\n\n'
          + '<b>Manage:</b>\n'
          + '• "Categorize my uncategorized expenses"\n'
          + '• "Show expenses pending review"\n'
          + '• "Show recurring subscriptions"\n'
          + '• "Any alerts I should know about?"\n\n'
          + '<b>Correct:</b>\n'
          + '• "No, that should be Travel" — re-categorizes &amp; learns\n'
          + '• "Show vendor spending patterns"',
        invoices:
          '🧾 <b>Invoices</b>\n\n'
          + '<b>Create:</b>\n'
          + '• "Invoice Acme $5000 for consulting"\n'
          + '• "Create estimate for TechCorp $3000 web design"\n\n'
          + '<b>Send &amp; Track:</b>\n'
          + '• "Send that invoice"\n'
          + '• "Show my invoices"\n'
          + '• "Show unpaid invoices"\n'
          + '• "Who owes me money?" — AR aging report\n\n'
          + '<b>Payments:</b>\n'
          + '• "Got $5000 from Acme"\n'
          + '• "Send payment reminders"\n\n'
          + '<b>Clients:</b>\n'
          + '• "Show my clients"\n'
          + '• "Show pending estimates"',
        tax:
          '🧾 <b>Tax</b>\n\n'
          + '<b>Quick Checks:</b>\n'
          + '• "How much tax do I owe?"\n'
          + '• "Show quarterly payments"\n'
          + '• "What deductions can I claim?"\n\n'
          + '<b>Tax Filing (Canada T1/T2125/GST):</b>\n'
          + '• "Start my tax filing" — creates session, auto-fills from books\n'
          + '• Send T4, T5, RRSP slips as photos — I\'ll OCR them\n'
          + '• "Review T2125" / "Review T1" / "Review GST return"\n'
          + '• "What\'s missing for my tax filing?"\n'
          + '• "Validate my tax return"\n'
          + '• "Export my tax forms"\n'
          + '• "Submit to CRA" — e-file via partner API\n'
          + '• "Check filing status"',
        reports:
          '📊 <b>Reports</b>\n\n'
          + '• "Show profit and loss"\n'
          + '• "Show balance sheet"\n'
          + '• "How long will my cash last?" — cashflow projection\n'
          + '• "Financial summary"\n'
          + '• "Spending breakdown"\n'
          + '• "Show bank reconciliation status"',
        timer:
          '⏱ <b>Time Tracking</b>\n\n'
          + '• "Start timer for TechCorp project"\n'
          + '• "Stop timer"\n'
          + '• "Is my timer running?"\n'
          + '• "Show unbilled time"\n\n'
          + 'Unbilled time can be converted to invoices.',
        planning:
          '🧠 <b>Planning &amp; Automation</b>\n\n'
          + '<b>Multi-step tasks:</b>\n'
          + '• "Categorize expenses and then show breakdown"\n'
          + '• "Invoice Acme $5000 and then send it"\n'
          + '• I\'ll show you the plan first, you confirm\n\n'
          + '<b>Simulations:</b>\n'
          + '• "What if I hire someone at $5K/mo?"\n'
          + '• "What money moves should I make?"\n\n'
          + '<b>Automations:</b>\n'
          + '• "Alert me when spending exceeds $500"\n'
          + '• "Show my automations"\n\n'
          + '<b>Session commands:</b>\n'
          + '• "yes" / "no" — confirm or cancel a plan\n'
          + '• "undo" — revert last action\n'
          + '• "skip" — skip current step\n'
          + '• "status" — check active plan',
        cpa:
          '👔 <b>CPA Collaboration</b>\n\n'
          + '• "Show my CPA notes"\n'
          + '• "Add note for CPA: review Q3 expenses"\n'
          + '• "Share access with my accountant"',
        telegram:
          '🤖 <b>Telegram Bot Setup</b>\n\n'
          + '<b>Connect your own bot:</b>\n'
          + '1. Open @BotFather in Telegram\n'
          + '2. Send /newbot and follow the prompts\n'
          + '3. Copy the API token\n'
          + '4. Call the API:\n'
          + '<code>POST /api/v1/agentbook-core/telegram/setup</code>\n'
          + '<code>{"botToken": "YOUR_TOKEN"}</code>\n\n'
          + '<b>Check status:</b>\n'
          + '• "Check my Telegram bot status"\n\n'
          + '<b>Disconnect:</b>\n'
          + '<code>DELETE /api/v1/agentbook-core/telegram/disconnect</code>',
      };

      const helpText = helpTopics[topic];
      if (helpText) {
        await ctx.reply(helpText, { parse_mode: 'HTML' });
      } else {
        await ctx.reply(`No help found for "${topic}". Try: /help expenses, /help invoices, /help tax, /help reports, /help timer, /help planning, /help cpa`);
      }
      return;
    }

    const lower = text.toLowerCase().trim();

    // Detect feedback/corrections FIRST (takes precedence over session cancel)
    let feedback: string | undefined;
    if (/^(no[, ]+\w|wrong[, ]+|should be |that's |it's )/i.test(lower)) {
      feedback = text;
    }

    // Detect session actions (only exact single-word/phrase matches)
    let sessionAction: string | undefined;
    if (!feedback) {
      if (/^(yes|confirm|go|ok|proceed|do it|y)$/i.test(lower)) sessionAction = 'confirm';
      else if (/^(no|cancel|stop|abort|nevermind|n)$/i.test(lower)) sessionAction = 'cancel';
      else if (/^(undo|revert|undo that)$/i.test(lower)) sessionAction = 'undo';
      else if (/^(skip|next)$/i.test(lower)) sessionAction = 'skip';
      else if (/^(status|where was i)$/i.test(lower)) sessionAction = 'status';
    }

    // Slash command shortcuts → rewrite as natural language for the agent
    const slashMap: Record<string, string> = {
      '/balance': 'What is my cash balance?',
      '/tax': 'What is my tax situation?',
      '/revenue': 'How much revenue do I have?',
      '/clients': 'Who owes me money?',
    };
    const cmd = text.split(' ')[0].toLowerCase();
    const agentText = slashMap[cmd] || text;

    try {
      const result = await callAgentBrain(tenantId, agentText, undefined, sessionAction, feedback);
      if (result.success && result.data) {
        const reply: string = formatResponse(result.data);

        // Build inline keyboard based on context
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let keyboard: any = undefined;
        const planMaybe = (result.data as { plan?: { requiresConfirmation?: boolean } }).plan;
        if (planMaybe?.requiresConfirmation) {
          keyboard = { inline_keyboard: [[
            { text: '\u2705 Proceed', callback_data: 'session:confirm' },
            { text: '\u274C Cancel', callback_data: 'session:cancel' },
          ]] };
        } else if (result.data.skillUsed === 'record-expense' && result.data.message?.includes('Recorded')) {
          keyboard = { inline_keyboard: [[
            { text: '\u{1F4C1} Category', callback_data: 'change_cat:agent' },
            { text: '\u{1F3E0} Personal', callback_data: 'personal:agent' },
          ]] };
        }

        try {
          await ctx.reply(reply, { reply_markup: keyboard, parse_mode: 'HTML' });
        } catch {
          await ctx.reply(result.data.message || reply, { reply_markup: keyboard });
        }
      } else {
        await ctx.reply('I\'m not sure what you mean. Type /help for options.');
      }
    } catch (err) {
      console.error('Agent brain error:', err);
      await ctx.reply('Something went wrong. Please try again.');
    }
  });

  // === Photo messages → Receipt OCR (not yet wired in this build) ===
  // Receipt OCR / document parsing relies on the agent-brain pipeline,
  // which isn't bundled in this build. Acknowledge so the user isn't
  // left wondering why nothing happens.
  bot.on('message:photo', async (ctx) => {
    await ctx.reply('🧾 I received your photo, but receipt OCR isn\'t enabled in this build yet. Please type the expense — e.g. "Spent $45 on lunch at Starbucks".');
  });

  bot.on('message:document', async (ctx) => {
    await ctx.reply('📄 I received your file, but document OCR isn\'t enabled in this build yet. Please type the expense or invoice details directly.');
  });

  bot.on('callback_query:data', async (ctx) => {
    const cbData = ctx.callbackQuery.data;
    try {
      const [action, expenseId] = cbData.split(':');

      if (action === 'reject' && expenseId) {
        const tenantId = ctx.chat?.id ? await resolveTenantId(ctx.chat.id) : '';
        await db.abExpense.updateMany({
          where: { id: expenseId, tenantId },
          data: { status: 'rejected' },
        });
        await ctx.answerCallbackQuery({ text: '❌ Expense rejected' });
        await ctx.editMessageText('❌ Expense rejected.');
        return;
      }

      if (action === 'personal' && expenseId) {
        const tenantId = ctx.chat?.id ? await resolveTenantId(ctx.chat.id) : '';
        await db.abExpense.updateMany({
          where: { id: expenseId, tenantId },
          data: { isPersonal: true },
        });
        await ctx.answerCallbackQuery({ text: '🏠 Marked as personal' });
        await ctx.editMessageText('🏠 Marked as personal expense (excluded from business books).');
        return;
      }

      // Other callbacks (session: confirm/cancel, change_cat, expense confirm)
      // depend on the agent-brain pipeline.
      await ctx.answerCallbackQuery({ text: 'That action needs the agent brain — not enabled yet.' });
    } catch (err) {
      console.error('Callback error:', err);
      await ctx.answerCallbackQuery({ text: 'Error processing action' });
    }
  });

  return bot;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const secret = request.headers.get('X-Telegram-Bot-Api-Secret-Token');
  const expectedSecret = process.env.TELEGRAM_WEBHOOK_SECRET;

  if (expectedSecret && secret !== expectedSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!process.env.TELEGRAM_BOT_TOKEN) {
    return NextResponse.json({ error: 'Bot not configured' }, { status: 503 });
  }

  try {
    const b = getBot();
    if (!b.isInited()) {
      await b.init();
    }
    const update = await request.json();
    const captureBuf: CaptureEntry[] | null = E2E_CAPTURE ? [] : null;
    if (captureBuf) currentCapture = captureBuf;
    try {
      await b.handleUpdate(update);
    } finally {
      if (captureBuf) currentCapture = null;
    }
    if (captureBuf) {
      return NextResponse.json({
        ok: true,
        captured: captureBuf,
        botReply: captureBuf[0]?.text,
      });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('Telegram webhook error:', err);
    return NextResponse.json({ ok: true }); // Always return 200 to Telegram
  }
}

export async function GET(): Promise<NextResponse> {
  return NextResponse.json({ status: 'AgentBook Telegram webhook active', configured: !!process.env.TELEGRAM_BOT_TOKEN });
}
