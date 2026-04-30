/**
 * AgentBook Telegram Bot — Grammy webhook mode.
 *
 * Handles: text messages, photos (receipts), documents (PDFs),
 * voice notes, and inline keyboard callbacks.
 *
 * Serverless-compatible: handleWebhook() processes a single update.
 */

import { Bot, webhookCallback, InlineKeyboard, Context } from 'grammy';

export interface BotConfig {
  token: string;
  webhookSecret?: string;
  onTextExpense: (chatId: number, text: string, tenantId: string) => Promise<ExpenseResult>;
  onPhotoReceipt: (chatId: number, fileId: string, tenantId: string) => Promise<ReceiptResult>;
  onDocumentReceipt: (chatId: number, fileId: string, fileName: string, tenantId: string) => Promise<ReceiptResult>;
  onCallbackQuery: (chatId: number, data: string, tenantId: string) => Promise<CallbackResult>;
}

export interface ExpenseResult {
  success: boolean;
  message: string;
  keyboard?: InlineKeyboard;
  expenseId?: string;
}

export interface ReceiptResult {
  success: boolean;
  message: string;
  keyboard?: InlineKeyboard;
  expenseId?: string;
  confidence?: number;
}

export interface CallbackResult {
  success: boolean;
  message: string;
  editOriginal?: boolean;
}

let botInstance: Bot | null = null;

export function createBot(config: BotConfig): Bot {
  const bot = new Bot(config.token);

  // === Text messages (expense recording) ===
  bot.on('message:text', async (ctx) => {
    const text = ctx.message.text;
    const chatId = ctx.chat.id;
    const tenantId = String(chatId); // In production, map chatId to tenantId

    // Skip commands
    if (text.startsWith('/')) {
      await handleCommand(ctx, text);
      return;
    }

    try {
      // Detect expense questions and route to AI advisor
      const expenseQuestionPattern = /how much|spending|spent|expenses?|travel cost|top categor|duplicate|any savings|subscription|software cost|biggest expense|compare.*month|what did i|show me.*spend|break ?down/i;
      if (expenseQuestionPattern.test(text)) {
        try {
          const advisorRes = await fetch(
            `${process.env.AGENTBOOK_EXPENSE_URL || 'http://localhost:4051'}/api/v1/agentbook-expense/advisor/ask`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'x-tenant-id': tenantId },
              body: JSON.stringify({ question: text }),
            },
          );
          const advisorData = await advisorRes.json() as any;
          if (advisorData.success && advisorData.data?.answer) {
            let reply = `🤖 <b>Expense Advisor</b>\n\n${advisorData.data.answer}`;
            if (advisorData.data.chartData?.data) {
              reply += '\n\n📊 <b>Breakdown:</b>';
              for (const d of advisorData.data.chartData.data.slice(0, 8)) {
                reply += `\n• ${d.name}: $${(d.value / 100).toLocaleString()}`;
              }
            }
            const keyboard = new InlineKeyboard();
            if (advisorData.data.actions?.length) {
              for (const a of advisorData.data.actions.slice(0, 3)) {
                keyboard.text(a.label, `advisor:${a.label}`);
              }
              keyboard.row();
            }
            keyboard.text('📊 Full Report', 'advisor:full_report');
            await ctx.reply(reply, { reply_markup: keyboard, parse_mode: 'HTML' });
            return;
          }
        } catch (advisorErr) {
          console.warn('Expense advisor Telegram fallback:', advisorErr);
          // Fall through to normal expense recording
        }
      }

      const result = await config.onTextExpense(chatId, text, tenantId);
      if (result.keyboard) {
        await ctx.reply(result.message, { reply_markup: result.keyboard, parse_mode: 'HTML' });
      } else {
        await ctx.reply(result.message, { parse_mode: 'HTML' });
      }
    } catch (err) {
      await ctx.reply('Sorry, I had trouble processing that. Please try again.');
      console.error('Text expense error:', err);
    }
  });

  // === Photo messages (receipt capture — the hero flow) ===
  bot.on('message:photo', async (ctx) => {
    const chatId = ctx.chat.id;
    const tenantId = String(chatId);

    // Get the highest resolution photo
    const photos = ctx.message.photo;
    const bestPhoto = photos[photos.length - 1];

    await ctx.reply('🧾 Reading your receipt...');

    try {
      const result = await config.onPhotoReceipt(chatId, bestPhoto.file_id, tenantId);
      if (result.keyboard) {
        await ctx.reply(result.message, { reply_markup: result.keyboard, parse_mode: 'HTML' });
      } else {
        await ctx.reply(result.message, { parse_mode: 'HTML' });
      }
    } catch (err) {
      await ctx.reply('Sorry, I couldn\'t read that receipt. Try taking a clearer photo, or type the expense manually.');
      console.error('Photo receipt error:', err);
    }
  });

  // === Document messages (forwarded email receipts, PDFs) ===
  bot.on('message:document', async (ctx) => {
    const chatId = ctx.chat.id;
    const tenantId = String(chatId);
    const doc = ctx.message.document;

    if (!doc) return;

    const fileName = doc.file_name || 'document';
    const mimeType = doc.mime_type || '';

    // Only process PDFs, images, and common document types
    const supported = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
    if (!supported.some(t => mimeType.startsWith(t.split('/')[0]))) {
      await ctx.reply('I can process receipt photos, PDFs, and images. This file type isn\'t supported.');
      return;
    }

    await ctx.reply('📧 Processing your document...');

    try {
      const result = await config.onDocumentReceipt(chatId, doc.file_id, fileName, tenantId);
      if (result.keyboard) {
        await ctx.reply(result.message, { reply_markup: result.keyboard, parse_mode: 'HTML' });
      } else {
        await ctx.reply(result.message, { parse_mode: 'HTML' });
      }
    } catch (err) {
      await ctx.reply('Sorry, I couldn\'t process that document. Try sending a photo instead.');
      console.error('Document receipt error:', err);
    }
  });

  // === Inline keyboard callbacks ===
  bot.on('callback_query:data', async (ctx) => {
    const chatId = ctx.chat?.id;
    if (!chatId) return;

    const tenantId = String(chatId);
    const data = ctx.callbackQuery.data;

    try {
      const result = await config.onCallbackQuery(chatId, data, tenantId);

      await ctx.answerCallbackQuery();

      if (result.editOriginal && ctx.callbackQuery.message) {
        await ctx.editMessageText(result.message, { parse_mode: 'HTML' });
      } else {
        await ctx.reply(result.message, { parse_mode: 'HTML' });
      }
    } catch (err) {
      await ctx.answerCallbackQuery({ text: 'Something went wrong' });
      console.error('Callback query error:', err);
    }
  });

  // === Voice notes (stretch goal — speech-to-text) ===
  bot.on('message:voice', async (ctx) => {
    await ctx.reply('Voice notes will be supported soon! For now, please type your expense or send a receipt photo.');
  });

  botInstance = bot;
  return bot;
}

async function handleCommand(ctx: Context, text: string): Promise<void> {
  const command = text.split(' ')[0].toLowerCase();

  switch (command) {
    case '/start':
      await ctx.reply(
        '👋 Welcome to AgentBook!\n\n' +
        'I\'m your AI bookkeeping agent. Here\'s what I can do:\n\n' +
        '📸 <b>Send a receipt photo</b> — I\'ll read it and record the expense\n' +
        '💬 <b>Type an expense</b> — "Spent $45 on lunch"\n' +
        '📄 <b>Forward a receipt email</b> — I\'ll parse it\n\n' +
        'Quick commands:\n' +
        '/expense — Record an expense\n' +
        '/balance — Check your cash balance\n' +
        '/tax — Tax estimate\n' +
        '/help — Get help',
        { parse_mode: 'HTML' }
      );
      break;
    case '/help':
      await ctx.reply(
        '📚 <b>AgentBook Help</b>\n\n' +
        '<b>Record expenses:</b>\n' +
        '• Send a receipt photo\n' +
        '• Type: "Spent $45 on lunch"\n' +
        '• Forward an email receipt\n\n' +
        '<b>Commands:</b>\n' +
        '/expense — Record expense\n' +
        '/balance — Cash balance\n' +
        '/tax — Tax estimate\n' +
        '/reports — Financial reports\n' +
        '/settings — Configure AgentBook',
        { parse_mode: 'HTML' }
      );
      break;
    case '/expense':
      await ctx.reply('💰 Send me a receipt photo, or type the expense (e.g., "Spent $45 on lunch")');
      break;
    default:
      await ctx.reply('I don\'t recognize that command. Type /help for available commands.');
  }
}

/**
 * Webhook handler for Vercel serverless.
 * Call this from your Next.js API route.
 */
export function handleWebhook(bot: Bot): (req: Request) => Promise<Response> {
  return webhookCallback(bot, 'std/http', {
    timeoutMilliseconds: 25000, // Under Vercel's 30s limit
  });
}

/**
 * Send a proactive message to a user.
 * Used by the proactive engine for daily pulse, reminders, etc.
 */
export async function sendProactiveMessage(
  chatId: number,
  text: string,
  keyboard?: InlineKeyboard,
): Promise<void> {
  if (!botInstance) throw new Error('Bot not initialized');

  if (keyboard) {
    await botInstance.api.sendMessage(chatId, text, { reply_markup: keyboard, parse_mode: 'HTML' });
  } else {
    await botInstance.api.sendMessage(chatId, text, { parse_mode: 'HTML' });
  }
}
