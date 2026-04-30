/**
 * Telegram Bot Webhook — Thin adapter that routes all messages through
 * the channel-agnostic Agent Brain at POST /agent/message.
 */
import { NextRequest, NextResponse } from 'next/server';
import { Bot } from 'grammy';

// Dev fallback: hardcoded chat ID → tenant mapping
const CHAT_TO_TENANT_FALLBACK: Record<string, string> = {
  '5336658682': '2e2348b6-a64c-44ad-907e-4ac120ff06f2', // Qiang → Maya
};

const CORE_API = process.env.AGENTBOOK_CORE_URL || 'http://localhost:4050';

/** Resolve tenant from chat ID — checks DB first, falls back to hardcoded dev mapping. */
async function resolveTenantId(chatId: number, botToken?: string): Promise<string> {
  const chatStr = String(chatId);

  // Try DB lookup: find bot config where chatIds contains this chat ID
  try {
    const res = await fetch(`${CORE_API}/api/v1/agentbook-core/telegram/resolve-chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chatId: chatStr, botToken }),
    });
    if (res.ok) {
      const data = await res.json() as any;
      if (data.data?.tenantId) return data.data.tenantId;
    }
  } catch { /* DB lookup failed, use fallback */ }

  if (CHAT_TO_TENANT_FALLBACK[chatStr]) return CHAT_TO_TENANT_FALLBACK[chatStr];
  console.warn(`Unknown Telegram chat ${chatStr} — no tenant mapping found`);
  return `unmapped:${chatStr}`; // Will not match any real tenantId, prevents silent data pollution
}

/** Call the agent brain and return the response data. */
async function callAgentBrain(
  tenantId: string, text: string,
  attachments?: { type: string; url: string }[],
  sessionAction?: string, feedback?: string,
): Promise<any> {
  const res = await fetch(`${CORE_API}/api/v1/agentbook-core/agent/message`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-tenant-id': tenantId },
    body: JSON.stringify({ text, channel: 'telegram', attachments, sessionAction, feedback }),
  });
  return res.json();
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
        let reply: string;
        if (result.data.plan?.requiresConfirmation) {
          // Show plan with confirm/cancel buttons
          reply = escHtml(result.data.message);
        } else if (result.data.evaluation) {
          // Show evaluation results
          reply = mdToHtml(result.data.message);
        } else {
          reply = formatResponse(result.data);
        }

        // Build inline keyboard based on context
        let keyboard: any = undefined;
        if (result.data.plan?.requiresConfirmation) {
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

  // === Photo messages → Agent Brain with attachment ===
  bot.on('message:photo', async (ctx) => {
    const tenantId = await resolveTenantId(ctx.chat.id);
    const photos = ctx.message.photo;
    const bestPhoto = photos[photos.length - 1];

    await ctx.reply('🧾 Reading your receipt...');

    try {
      const file = await ctx.api.getFile(bestPhoto.file_id);
      const telegramUrl = `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${file.file_path}`;

      // Upload to blob storage first
      const expenseApi = process.env.AGENTBOOK_EXPENSE_URL || 'http://localhost:4051';
      const blobRes = await fetch(`${expenseApi}/api/v1/agentbook-expense/receipts/upload-blob`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-tenant-id': tenantId },
        body: JSON.stringify({ sourceUrl: telegramUrl }),
      });
      const blobData = await blobRes.json() as any;
      const permanentUrl = blobData.data?.permanentUrl || telegramUrl;

      const result = await callAgentBrain(tenantId, ctx.message.caption || '', [
        { type: 'photo', url: permanentUrl },
      ]);

      if (result.success && result.data) {
        await ctx.reply(formatResponse(result.data), { parse_mode: 'HTML' });
      } else {
        await ctx.reply('🧾 I saved the receipt but couldn\'t process it.\n\nPlease type the expense, e.g.: "Spent $45 on lunch"', { parse_mode: 'HTML' });
      }
    } catch (err) {
      console.error('Photo receipt error:', err);
      await ctx.reply('Sorry, I couldn\'t process that receipt. Try a clearer photo, or type the expense manually.');
    }
  });

  // === Document messages (PDF) → Agent Brain with attachment ===
  bot.on('message:document', async (ctx) => {
    const tenantId = await resolveTenantId(ctx.chat.id);
    const doc = ctx.message.document;
    const mimeType = doc.mime_type || '';

    if (!mimeType.includes('pdf') && !mimeType.includes('image')) {
      await ctx.reply('I can process PDF receipts and images. Please send a receipt photo or PDF.');
      return;
    }

    await ctx.reply(`📄 Processing ${doc.file_name || 'document'}...`);

    try {
      const file = await ctx.api.getFile(doc.file_id);
      const telegramUrl = `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${file.file_path}`;

      const expenseApi = process.env.AGENTBOOK_EXPENSE_URL || 'http://localhost:4051';
      const blobRes = await fetch(`${expenseApi}/api/v1/agentbook-expense/receipts/upload-blob`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-tenant-id': tenantId },
        body: JSON.stringify({ sourceUrl: telegramUrl }),
      });
      const blobData = await blobRes.json() as any;
      const permanentUrl = blobData.data?.permanentUrl || telegramUrl;

      const attType = mimeType.includes('pdf') ? 'pdf' : 'photo';
      const result = await callAgentBrain(tenantId, ctx.message.caption || '', [
        { type: attType, url: permanentUrl },
      ]);

      if (result.success && result.data) {
        await ctx.reply(formatResponse(result.data), { parse_mode: 'HTML' });
      } else {
        await ctx.reply(`📄 Saved ${doc.file_name || 'document'} but couldn't extract expense data.\n\nPlease type the expense manually.`);
      }
    } catch (err) {
      console.error('Document receipt error:', err);
      await ctx.reply('Sorry, I couldn\'t process that document. Try sending it as a photo instead.');
    }
  });

  // === Callback queries (inline keyboard buttons) ===
  bot.on('callback_query:data', async (ctx) => {
    const cbData = ctx.callbackQuery.data;
    const tenantId = ctx.chat?.id ? await resolveTenantId(ctx.chat.id) : '';
    const expenseApi = process.env.AGENTBOOK_EXPENSE_URL || 'http://localhost:4051';

    try {
      const [action, expenseId] = cbData.split(':');

      if (action === 'session') {
        const sessionAction = expenseId; // 'confirm' or 'cancel'
        const result = await callAgentBrain(tenantId, sessionAction, undefined, sessionAction);
        await ctx.answerCallbackQuery({ text: sessionAction === 'confirm' ? 'Executing...' : 'Cancelled' });
        if (result.success && result.data?.message) {
          try {
            await ctx.editMessageText(mdToHtml(result.data.message), { parse_mode: 'HTML' });
          } catch {
            await ctx.reply(result.data.message);
          }
        }
        return;
      }

      if (action === 'confirm' && expenseId) {
        await fetch(`${expenseApi}/api/v1/agentbook-expense/expenses/${expenseId}/confirm`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-tenant-id': tenantId },
        });
        await ctx.answerCallbackQuery({ text: '✅ Expense confirmed!' });
        await ctx.editMessageText('✅ Expense confirmed and posted to your books.');
      } else if (action === 'reject' && expenseId) {
        await fetch(`${expenseApi}/api/v1/agentbook-expense/expenses/${expenseId}/reject`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-tenant-id': tenantId },
        });
        await ctx.answerCallbackQuery({ text: '❌ Expense rejected' });
        await ctx.editMessageText('❌ Expense rejected.');
      } else if (action === 'personal' && expenseId) {
        await fetch(`${expenseApi}/api/v1/agentbook-expense/expenses/${expenseId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', 'x-tenant-id': tenantId },
          body: JSON.stringify({ isPersonal: true }),
        });
        await ctx.answerCallbackQuery({ text: '🏠 Marked as personal' });
        await ctx.editMessageText('🏠 Marked as personal expense (excluded from business books).');
      } else if (action === 'change_cat') {
        // Category change — route through agent as a correction prompt
        await ctx.answerCallbackQuery({ text: 'What category?' });
        await ctx.reply('What category should this be? (e.g., "Travel", "Meals", "Software")');
      } else {
        await ctx.answerCallbackQuery({ text: `Action: ${cbData}` });
      }
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
    await b.handleUpdate(update);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('Telegram webhook error:', err);
    return NextResponse.json({ ok: true }); // Always return 200 to Telegram
  }
}

export async function GET(): Promise<NextResponse> {
  return NextResponse.json({ status: 'AgentBook Telegram webhook active', configured: !!process.env.TELEGRAM_BOT_TOKEN });
}
