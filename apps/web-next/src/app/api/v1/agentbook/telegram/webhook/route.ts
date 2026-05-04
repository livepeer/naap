/**
 * Telegram Bot Webhook.
 *
 * Routes all messages through the full agent-brain pipeline imported
 * from the plugin source: memory, planner, evaluator, 16 skills, and
 * Gemini for natural-language understanding. Cross-plugin HTTP calls
 * inside classifyAndExecuteV1 hit native Next.js routes on the same
 * host (set via AGENTBOOK_*_URL env vars).
 *
 * The minimal pattern-matched agent below remains as an offline
 * fallback so the bot still responds when Gemini is unavailable.
 */
import { NextRequest, NextResponse } from 'next/server';
import { Bot } from 'grammy';
import { prisma as db } from '@naap/database';
import { handleAgentMessage } from '@agentbook-core/agent-brain';
import { callGemini, classifyAndExecuteV1 } from '@agentbook-core/server';

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

/**
 * Turn a callback `expenseId` token into a real id. The agent attaches
 * the literal "agent" token to record-expense replies because the brain
 * doesn't yet propagate the created id through to the keyboard. Map
 * "agent" to the most-recent expense for this tenant; pass through real
 * UUIDs unchanged.
 */
async function resolveExpenseId(tenantId: string, token: string | undefined): Promise<string | null> {
  if (!token) return null;
  if (token !== 'agent' && token.length > 8) return token;
  const recent = await db.abExpense.findFirst({
    where: { tenantId },
    orderBy: { createdAt: 'desc' },
    select: { id: true },
  });
  return recent?.id ?? null;
}

function normalizeVendorName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '').trim();
}

async function getGeminiKey(): Promise<{ apiKey: string; modelVision: string } | null> {
  if (process.env.GEMINI_API_KEY) {
    return {
      apiKey: process.env.GEMINI_API_KEY,
      modelVision: process.env.GEMINI_MODEL_VISION || 'gemini-2.5-flash',
    };
  }
  try {
    const cfg = await db.abLLMProviderConfig.findFirst({
      where: { enabled: true, isDefault: true, provider: 'gemini' },
    });
    if (cfg?.apiKey) {
      return { apiKey: cfg.apiKey, modelVision: cfg.modelVision || cfg.modelStandard || 'gemini-2.5-flash' };
    }
  } catch (err) {
    console.warn('[telegram/ocr] LLM config lookup failed:', err);
  }
  return null;
}

interface ReceiptOcrResult {
  amount_cents: number;
  vendor: string | null;
  date: string;
  currency: string;
  items: string | null;
  tax_cents: number;
  tip_cents: number;
  confidence: number;
}

/** Run Gemini Vision OCR on a receipt image or PDF URL. Returns null on failure. */
async function ocrReceipt(fileUrl: string, hintMime?: string): Promise<ReceiptOcrResult | null> {
  const cfg = await getGeminiKey();
  if (!cfg) return null;

  let imagePart: { inlineData: { mimeType: string; data: string } } | { text: string };
  try {
    const fileRes = await fetch(fileUrl);
    if (!fileRes.ok) throw new Error(`fetch ${fileRes.status}`);
    const buf = await fileRes.arrayBuffer();
    const headerMime = fileRes.headers.get('content-type') || '';
    // Trust the explicit hint over a generic header (Telegram serves PDFs as
    // application/octet-stream, which Gemini rejects).
    let mimeType = (hintMime && hintMime !== 'application/octet-stream' ? hintMime : headerMime) || '';
    if (!mimeType || mimeType === 'application/octet-stream') {
      mimeType = fileUrl.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'image/jpeg';
    }
    // Gemini accepts inline PDFs up to ~20 MB; images are typically capped
    // around 4 MB before performance/quality drops noticeably. Use a single
    // 18 MB budget for both — anything larger falls back to a URL hint.
    if (buf.byteLength > 18_000_000) {
      imagePart = { text: `[File too large for inline OCR — ${(buf.byteLength / 1_000_000).toFixed(1)} MB. URL: ${fileUrl}]` };
    } else {
      imagePart = { inlineData: { mimeType, data: Buffer.from(buf).toString('base64') } };
    }
  } catch (err) {
    console.warn('[telegram/ocr] file download failed:', err);
    return null;
  }

  const systemPrompt = `You are an expert receipt and invoice scanner. The input may be a photo OR a PDF (single- or multi-page).

INSTRUCTIONS:
- For a multi-page PDF, treat the entire document as one purchase — find the GRAND TOTAL on whichever page it appears.
- The TOTAL / AMOUNT DUE is the most important field — usually the largest number, often after "Total"/"Amount Due"/"Grand Total"/"Balance Due".
- Vendor/merchant/issuer name is usually at the top of page 1.
- Date may be MM/DD/YYYY, YYYY-MM-DD, DD/MM/YYYY, or "Mon DD YYYY". Pick the issue/transaction date, not the due date if a separate due date exists.
- amount_cents is the GRAND TOTAL in CENTS (e.g., $45.99 = 4599, $1,234.56 = 123456).
- If you can't read the total at all, set amount_cents=0 and confidence=0.

Return ONLY valid JSON:
{"amount_cents": <int>, "vendor": "<string|null>", "date": "<YYYY-MM-DD>", "currency": "USD|CAD", "items": "<string|null>", "tax_cents": <int>, "tip_cents": <int>, "confidence": <0.0-1.0>}`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${cfg.modelVision}:generateContent?key=${cfg.apiKey}`;
  let llmRes: Response;
  try {
    llmRes = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: 'user', parts: [imagePart, { text: 'Extract the receipt data.' }] }],
        generationConfig: { maxOutputTokens: 2048, temperature: 0.1 },
      }),
    });
  } catch (err) {
    console.warn('[telegram/ocr] Gemini fetch failed:', err);
    return null;
  }

  if (!llmRes.ok) {
    const body = await llmRes.text().catch(() => '');
    console.warn('[telegram/ocr] Gemini HTTP error:', llmRes.status, body.slice(0, 300));
    return null;
  }

  let raw: string;
  try {
    const data = await llmRes.json() as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    raw = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  } catch {
    return null;
  }

  try {
    const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const json = cleaned.match(/\{[\s\S]*\}/)?.[0] || cleaned;
    const parsed = JSON.parse(json);
    return {
      amount_cents: parsed.amount_cents || 0,
      vendor: parsed.vendor || null,
      date: parsed.date || new Date().toISOString().slice(0, 10),
      currency: parsed.currency || 'USD',
      items: parsed.items || null,
      tax_cents: parsed.tax_cents || 0,
      tip_cents: parsed.tip_cents || 0,
      confidence: parsed.confidence ?? 0,
    };
  } catch (err) {
    console.warn('[telegram/ocr] Gemini parse failed:', err, raw.slice(0, 200));
    return null;
  }
}

/** Create an expense from OCR output. Returns the inserted expense id. */
async function createOcrExpense(
  tenantId: string,
  ocr: ReceiptOcrResult,
  receiptUrl: string,
  source: 'telegram_photo' | 'telegram_pdf',
): Promise<{ id: string; categoryId: string | null; vendorName: string | null }> {
  let vendor: { id: string; defaultCategoryId: string | null } | null = null;
  if (ocr.vendor) {
    const normalized = normalizeVendorName(ocr.vendor);
    if (normalized) {
      vendor = await db.abVendor.upsert({
        where: { tenantId_normalizedName: { tenantId, normalizedName: normalized } },
        update: { transactionCount: { increment: 1 }, lastSeen: new Date() },
        create: { tenantId, name: ocr.vendor, normalizedName: normalized },
        select: { id: true, defaultCategoryId: true },
      });
    }
  }

  let categoryId: string | null = vendor?.defaultCategoryId ?? null;
  if (!categoryId && vendor) {
    const pattern = await db.abPattern.findUnique({
      where: { tenantId_vendorPattern: { tenantId, vendorPattern: normalizeVendorName(ocr.vendor || '') } },
    });
    if (pattern) categoryId = pattern.categoryId;
  }

  const expenseDate = new Date(ocr.date);
  const safeDate = isNaN(expenseDate.getTime()) ? new Date() : expenseDate;

  const expense = await db.$transaction(async (tx) => {
    let journalEntryId: string | null = null;
    if (categoryId) {
      const cashAccount = await tx.abAccount.findFirst({ where: { tenantId, code: '1000' } });
      if (cashAccount) {
        const je = await tx.abJournalEntry.create({
          data: {
            tenantId,
            date: safeDate,
            memo: `Expense: ${ocr.vendor || ocr.items || 'Receipt'}`,
            sourceType: 'expense',
            verified: ocr.confidence >= 0.8,
            lines: {
              create: [
                { accountId: categoryId, debitCents: ocr.amount_cents, creditCents: 0, description: ocr.items || ocr.vendor || 'Expense' },
                { accountId: cashAccount.id, debitCents: 0, creditCents: ocr.amount_cents, description: `Payment: ${ocr.vendor || ''}` },
              ],
            },
          },
        });
        journalEntryId = je.id;
      }
    }

    const exp = await tx.abExpense.create({
      data: {
        tenantId,
        amountCents: ocr.amount_cents,
        taxAmountCents: ocr.tax_cents,
        tipAmountCents: ocr.tip_cents,
        vendorId: vendor?.id,
        categoryId,
        date: safeDate,
        description: ocr.items || ocr.vendor || 'Receipt',
        receiptUrl,
        currency: ocr.currency,
        confidence: ocr.confidence,
        status: ocr.confidence >= 0.6 && categoryId ? 'confirmed' : 'pending_review',
        source,
        journalEntryId,
      },
      include: { vendor: { select: { name: true } } },
    });

    await tx.abEvent.create({
      data: {
        tenantId,
        eventType: 'expense.recorded',
        actor: 'agent',
        action: {
          expense_id: exp.id,
          amountCents: ocr.amount_cents,
          vendor: ocr.vendor,
          categoryId,
          source,
          confidence: ocr.confidence,
        },
      },
    });

    return exp;
  });

  return { id: expense.id, categoryId, vendorName: expense.vendor?.name || ocr.vendor };
}

async function persistReceiptBlob(sourceUrl: string, tenantId: string, contentType: string): Promise<string> {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) return sourceUrl;
  try {
    const imgRes = await fetch(sourceUrl);
    if (!imgRes.ok) return sourceUrl;
    const ext = contentType.includes('pdf') ? 'pdf' : contentType.includes('png') ? 'png' : 'jpg';
    const filename = `receipts/${tenantId}/${Date.now()}.${ext}`;
    const { put } = await import('@vercel/blob');
    const blob = await put(filename, imgRes.body as never, { access: 'public', token, contentType });
    return blob.url;
  } catch (err) {
    console.warn('[telegram/blob] persist failed, using source URL:', err);
    return sourceUrl;
  }
}

/** Build the cross-plugin baseUrls map the agent brain expects. */
function getBaseUrls(): Record<string, string> {
  const host = process.env.AGENTBOOK_HOST || 'https://a3book.brainliber.com';
  return {
    '/api/v1/agentbook-core':    process.env.AGENTBOOK_CORE_URL    || host,
    '/api/v1/agentbook-expense': process.env.AGENTBOOK_EXPENSE_URL || host,
    '/api/v1/agentbook-invoice': process.env.AGENTBOOK_INVOICE_URL || host,
    '/api/v1/agentbook-tax':     process.env.AGENTBOOK_TAX_URL     || host,
  };
}

/** Run the full agent-brain pipeline. Falls back to the inline minimal agent on hard failure. */
async function callAgentBrain(
  tenantId: string,
  text: string,
  attachments?: { type: string; url: string }[],
  sessionAction?: string,
  feedback?: string,
): Promise<{ success: true; data: { message: string; skillUsed?: string } } | { success: false; error: string }> {
  try {
    const skills = await db.abSkillManifest.findMany({
      where: { enabled: true, OR: [{ tenantId: null }, { tenantId }] },
    });
    const baseUrls = getBaseUrls();
    const brainResult = await handleAgentMessage(
      { text: text || '', tenantId, channel: 'telegram', attachments, sessionAction, feedback },
      { skills, callGemini, baseUrls, classifyAndExecuteV1 },
    );
    if (brainResult?.success && brainResult.data?.message) {
      return brainResult as { success: true; data: { message: string; skillUsed?: string } };
    }
  } catch (err) {
    console.warn('[telegram/agent-brain] failed, falling back to inline agent:', err);
  }

  return callMinimalAgent(tenantId, text, sessionAction);
}

/** Pattern-matched offline fallback. Used when the agent brain throws. */
async function callMinimalAgent(
  tenantId: string,
  text: string,
  sessionAction?: string,
): Promise<{ success: true; data: { message: string; skillUsed?: string } } | { success: false; error: string }> {
  if (sessionAction) {
    return { success: true, data: { message: 'Session is no longer active.' } };
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
  bot.on('message:photo', async (ctx) => {
    const tenantId = await resolveTenantId(ctx.chat.id);
    const photos = ctx.message.photo;
    const best = photos[photos.length - 1];
    await ctx.reply('🧾 Reading your receipt…');

    try {
      const file = await ctx.api.getFile(best.file_id);
      const telegramUrl = `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${file.file_path}`;
      const permanentUrl = await persistReceiptBlob(telegramUrl, tenantId, 'image/jpeg');

      const ocr = await ocrReceipt(permanentUrl, 'image/jpeg');
      if (!ocr) {
        await ctx.reply('I saved the photo but couldn\'t run OCR on it. Either the image is unreadable or the Gemini key isn\'t configured. Type the expense, e.g. "Spent $45 on lunch at Starbucks".');
        return;
      }
      if (ocr.amount_cents === 0) {
        await ctx.reply('I read the image but couldn\'t find the total. Try a clearer photo, or type the expense (e.g. "Spent $45 on lunch").');
        return;
      }

      const expense = await createOcrExpense(tenantId, ocr, permanentUrl, 'telegram_photo');
      const conf = Math.round(ocr.confidence * 100);
      const status = ocr.confidence >= 0.6 && expense.categoryId
        ? '✅ Recorded'
        : '⚠️ Needs review';
      const reply = `${status}\n\n• Vendor: ${expense.vendorName || '—'}\n• Amount: ${fmtUsd(ocr.amount_cents)} ${ocr.currency}\n• Date: ${ocr.date}${ocr.tax_cents ? `\n• Tax: ${fmtUsd(ocr.tax_cents)}` : ''}${ocr.tip_cents ? `\n• Tip: ${fmtUsd(ocr.tip_cents)}` : ''}\n• Confidence: ${conf}%`;
      await ctx.reply(reply, {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [[
            { text: '🏠 Personal', callback_data: `personal:${expense.id}` },
            { text: '❌ Reject',   callback_data: `reject:${expense.id}` },
          ]],
        },
      });
    } catch (err) {
      console.error('[telegram/photo] failed:', err);
      await ctx.reply('Sorry, I couldn\'t process that receipt. Try a clearer photo, or type the expense manually.');
    }
  });

  bot.on('message:document', async (ctx) => {
    const tenantId = await resolveTenantId(ctx.chat.id);
    const doc = ctx.message.document;
    const mimeType = doc.mime_type || '';
    if (!mimeType.includes('pdf') && !mimeType.includes('image')) {
      await ctx.reply('I can read PDF or image receipts. Please send one of those, or type the expense.');
      return;
    }
    await ctx.reply(`📄 Processing ${doc.file_name || 'document'}…`);

    try {
      const file = await ctx.api.getFile(doc.file_id);
      const telegramUrl = `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${file.file_path}`;
      const permanentUrl = await persistReceiptBlob(telegramUrl, tenantId, mimeType);

      const ocr = await ocrReceipt(permanentUrl, mimeType);
      if (!ocr || ocr.amount_cents === 0) {
        await ctx.reply(`Saved ${doc.file_name || 'document'} but couldn't extract a total. Type the expense manually if you want it on the books.`);
        return;
      }

      const expense = await createOcrExpense(
        tenantId,
        ocr,
        permanentUrl,
        mimeType.includes('pdf') ? 'telegram_pdf' : 'telegram_photo',
      );
      const status = ocr.confidence >= 0.6 && expense.categoryId ? '✅ Recorded' : '⚠️ Needs review';
      await ctx.reply(`${status}\n\n• Vendor: ${expense.vendorName || '—'}\n• Amount: ${fmtUsd(ocr.amount_cents)} ${ocr.currency}\n• Date: ${ocr.date}\n• Confidence: ${Math.round(ocr.confidence * 100)}%`, {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [[
            { text: '🏠 Personal', callback_data: `personal:${expense.id}` },
            { text: '❌ Reject',   callback_data: `reject:${expense.id}` },
          ]],
        },
      });
    } catch (err) {
      console.error('[telegram/document] failed:', err);
      await ctx.reply('Sorry, I couldn\'t process that document. Try sending it as a photo, or type the expense.');
    }
  });

  bot.on('callback_query:data', async (ctx) => {
    const cbData = ctx.callbackQuery.data;
    try {
      const tenantId = ctx.chat?.id ? await resolveTenantId(ctx.chat.id) : '';
      const parts = cbData.split(':');
      const action = parts[0];

      if (action === 'reject') {
        const expenseId = await resolveExpenseId(tenantId, parts[1]);
        if (!expenseId) {
          await ctx.answerCallbackQuery({ text: 'No recent expense to reject' });
          return;
        }
        await db.abExpense.updateMany({
          where: { id: expenseId, tenantId },
          data: { status: 'rejected' },
        });
        await ctx.answerCallbackQuery({ text: '❌ Expense rejected' });
        await ctx.editMessageText('❌ Expense rejected.');
        return;
      }

      if (action === 'personal') {
        const expenseId = await resolveExpenseId(tenantId, parts[1]);
        if (!expenseId) {
          await ctx.answerCallbackQuery({ text: 'No recent expense to update' });
          return;
        }
        await db.abExpense.updateMany({
          where: { id: expenseId, tenantId },
          data: { isPersonal: true },
        });
        await ctx.answerCallbackQuery({ text: '🏠 Marked as personal' });
        await ctx.editMessageText('🏠 Marked as personal expense (excluded from business books).');
        return;
      }

      if (action === 'change_cat') {
        // Telegram caps callback_data at 64 bytes — UUID:UUID alone is 77.
        // Stash the active expense in AbUserMemory and reference by code only.
        const expenseId = await resolveExpenseId(tenantId, parts[1]);
        if (!expenseId) {
          await ctx.answerCallbackQuery({ text: 'No recent expense to categorize' });
          return;
        }
        const categories = await db.abAccount.findMany({
          where: { tenantId, accountType: 'expense', isActive: true },
          orderBy: { code: 'asc' },
          select: { id: true, name: true, code: true },
          take: 12,
        });
        if (categories.length === 0) {
          await ctx.answerCallbackQuery({ text: 'No expense categories — seed your chart of accounts first' });
          return;
        }
        // Remember which expense this Telegram chat is recategorizing, so the
        // cat:<code> callback below has enough context.
        const memoryKey = 'telegram:pending_recategorize';
        const memoryValue = JSON.stringify({ expenseId, setAt: Date.now() });
        await db.abUserMemory.upsert({
          where: { tenantId_key: { tenantId, key: memoryKey } },
          update: { value: memoryValue, lastUsed: new Date() },
          create: {
            tenantId,
            key: memoryKey,
            value: memoryValue,
            type: 'pending_action',
            confidence: 1,
          },
        });

        const rows: { text: string; callback_data: string }[][] = [];
        for (let i = 0; i < categories.length; i += 2) {
          rows.push(
            categories.slice(i, i + 2).map((c) => ({
              text: c.name,
              // Account code (e.g. "5800") fits well inside the 64-byte cap.
              callback_data: `cat:${c.code}`,
            })),
          );
        }
        await ctx.answerCallbackQuery({ text: 'Pick a category' });
        await ctx.reply('📁 Pick a category:', { reply_markup: { inline_keyboard: rows } });
        return;
      }

      if (action === 'cat') {
        const code = parts[1];
        if (!code) {
          await ctx.answerCallbackQuery({ text: 'Bad callback data' });
          return;
        }
        // Recover the expense id from the memory we wrote above.
        const memoryKey = 'telegram:pending_recategorize';
        const memory = await db.abUserMemory.findUnique({
          where: { tenantId_key: { tenantId, key: memoryKey } },
        });
        let expenseId: string | undefined;
        if (memory) {
          try {
            const parsed = JSON.parse(memory.value) as { expenseId?: string };
            expenseId = parsed.expenseId;
          } catch {
            // bad JSON, treat as missing
          }
        }
        if (!expenseId) {
          await ctx.answerCallbackQuery({ text: 'No expense in flight — re-record then tap Category' });
          return;
        }
        const account = await db.abAccount.findUnique({
          where: { tenantId_code: { tenantId, code } },
        });
        if (!account) {
          await ctx.answerCallbackQuery({ text: `Category ${code} not found` });
          return;
        }
        const categoryId = account.id;
        const expense = await db.abExpense.findFirst({ where: { id: expenseId, tenantId } });
        if (!expense) {
          await ctx.answerCallbackQuery({ text: 'Expense not found' });
          return;
        }
        await db.abExpense.update({
          where: { id: expenseId },
          data: { categoryId, confidence: 1.0 },
        });
        if (expense.vendorId) {
          const vendor = await db.abVendor.findUnique({ where: { id: expense.vendorId } });
          if (vendor) {
            await db.abPattern.upsert({
              where: { tenantId_vendorPattern: { tenantId, vendorPattern: vendor.normalizedName } },
              update: { categoryId, confidence: 0.95, source: 'user_corrected', usageCount: { increment: 1 }, lastUsed: new Date() },
              create: { tenantId, vendorPattern: vendor.normalizedName, categoryId, confidence: 0.95, source: 'user_corrected' },
            });
            await db.abVendor.update({ where: { id: vendor.id }, data: { defaultCategoryId: categoryId } });
          }
        }
        await ctx.answerCallbackQuery({ text: `✅ Categorized as ${account.name}` });
        try {
          await ctx.editMessageText(`✅ Categorized as <b>${account.name}</b>. The bot will remember this for similar expenses from the same vendor.`, { parse_mode: 'HTML' });
        } catch {
          await ctx.reply(`✅ Categorized as ${account.name}.`);
        }
        return;
      }

      if (action === 'session') {
        const sessionAction = parts[1];
        const result = await callAgentBrain(tenantId, sessionAction || 'status', undefined, sessionAction);
        await ctx.answerCallbackQuery({ text: sessionAction === 'confirm' ? 'Executing…' : 'Cancelled' });
        if (result.success && result.data?.message) {
          try {
            await ctx.editMessageText(mdToHtml(result.data.message), { parse_mode: 'HTML' });
          } catch {
            await ctx.reply(result.data.message);
          }
        }
        return;
      }

      await ctx.answerCallbackQuery({ text: `Unknown action: ${action}` });
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
