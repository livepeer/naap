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
import { randomBytes } from 'node:crypto';
import { Bot } from 'grammy';
import { prisma as db } from '@naap/database';
import { handleAgentMessage } from '@agentbook-core/agent-brain';
import { callGemini, classifyAndExecuteV1 } from '@agentbook-core/server';
import { runAgentLoop, type BotContext, type ActiveExpense as BotActive } from '@/lib/agentbook-bot-agent';
import { parseDateHint } from '@/lib/agentbook-time-aggregator';
import { autoCategorizeForTenant, getPendingSuggestions, dropPendingSuggestion } from '@/lib/agentbook-auto-categorize';
import { updateMileageEntry } from '@/lib/agentbook-mileage-service';
import {
  getDigestPrefs,
  setDigestPrefs,
  getSetupState,
  setSetupState,
  clearSetupState,
  parseTimeString,
  applyFeedbackToPrefs,
  formatPrefsSummary,
  formatTime,
  DEFAULT_PREFS,
  type DigestPrefs,
  type SetupState,
} from '@/lib/agentbook-digest-prefs';

// Dev fallback: hardcoded chat ID → tenant mapping. The tenantId here MUST
// match the tenant the user logs into the web UI as (the AgentBook tenant
// is the User.id), otherwise bot-recorded expenses won't show up there.
const CHAT_TO_TENANT_FALLBACK: Record<string, string> = {
  '5336658682': '020e55c5-da0e-4b9c-91cb-55b7f9c6527e', // Qiang → Maya web user (maya@agentbook.test)
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
 * Surface tax-line implications + ITC eligibility at the moment of
 * booking, so the user sees the actual deductible impact, not just
 * where it went on the chart of accounts.
 */
function buildTaxNote(
  categoryName: string,
  taxCategory: string,
  amountCents: number,
  taxCents: number = 0,
  jurisdiction: string = 'us',
): string {
  const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`;
  const cat = categoryName.toLowerCase();
  const line = (taxCategory || '').toLowerCase();
  const notes: string[] = [];

  // GST/HST — Canadian tenants can claim Input Tax Credits if registered.
  if (jurisdiction === 'ca' && taxCents > 0) {
    notes.push(`GST/HST on this receipt: ${dollars(taxCents)} — claim as ITC if you're registered.`);
  }

  // Meals: 50% deductible per IRS §274(n) / CRA equivalent.
  if (cat.includes('meal') || cat.includes('entertainment') || line.includes('24b')) {
    const deductible = Math.round(amountCents * 0.5);
    notes.push(`Heads up: meals are 50% deductible — effective write-off ≈ ${dollars(deductible)}.`);
  }
  // Alcohol-only purchases: 50% deductible US, 50% CA, often non-deductible if no business meal.
  else if (cat.includes('alcohol') || cat.includes('liquor') || cat.includes('bar')) {
    notes.push(`Alcohol on its own usually isn't deductible — only counts when it's part of a documented business meal.`);
  }
  // Vehicle / fuel — actual vs. mileage method.
  else if (cat.includes('car') || cat.includes('fuel') || cat.includes('truck') || line.includes('9')) {
    notes.push(`Vehicle expenses: actual-costs OR standard mileage — pick one method and stick with it all year.`);
  }
  // Travel.
  else if (cat.includes('travel') || line.includes('24a')) {
    notes.push(`Travel is fully deductible if overnight + business-purpose. Save the receipt.`);
  }
  // Software / subscriptions.
  else if (cat.includes('software') || cat.includes('subscription') || line.includes('27a')) {
    notes.push(`Software is 100% deductible if used purely for business. Personal use? Split it.`);
  }
  // Rent / home office.
  else if (cat.includes('rent') || line.includes('20b')) {
    notes.push(`Home-office portion only — track the business-use % and square footage.`);
  }
  // Gifts (US: $25/person/year cap).
  else if (cat.includes('gift') && jurisdiction === 'us') {
    if (amountCents > 2500) {
      notes.push(`⚠️ US gift cap: only $25/person/year is deductible. Anything above is not.`);
    }
  }

  return notes.join(' ');
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
- Vendor/merchant/issuer name is usually at the top of page 1. Return the CANONICAL BRAND NAME, not the raw print: "STARBUCKS #4521 PORTLAND OR" → "Starbucks", "WAL-MART STORE 0042" → "Walmart", "SHELL OIL 12-345-6789" → "Shell". Strip store numbers, location codes, and shouty caps.
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
): Promise<CreatedOcrExpense> {
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

  // Category inference: vendor default → vendor pattern → null (ask user).
  // Track WHERE the category came from so we can be honest with the user
  // when surfacing it ("I'm 75% sure" vs "you've put Shell here before").
  let categoryId: string | null = vendor?.defaultCategoryId ?? null;
  let categorySource: 'vendor_default' | 'pattern' | null = vendor?.defaultCategoryId ? 'vendor_default' : null;
  let categoryConfidence: number | null = vendor?.defaultCategoryId ? 0.95 : null;
  if (!categoryId && vendor) {
    const pattern = await db.abPattern.findUnique({
      where: { tenantId_vendorPattern: { tenantId, vendorPattern: normalizeVendorName(ocr.vendor || '') } },
    });
    if (pattern) {
      categoryId = pattern.categoryId;
      categorySource = 'pattern';
      categoryConfidence = pattern.confidence;
    }
  }

  const expenseDate = new Date(ocr.date);
  const safeDate = isNaN(expenseDate.getTime()) ? new Date() : expenseDate;

  // CONFIRMATION GATE: every receipt lands as a draft (status='pending_review')
  // and is NOT booked to the ledger until the user explicitly taps Confirm
  // or replies with "yes / looks good". This is the single biggest behavior
  // change between "automation that surprises you" and "accountant you trust".
  const expense = await db.$transaction(async (tx) => {
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
        status: 'pending_review',
        source,
        journalEntryId: null,
      },
      include: { vendor: { select: { name: true } } },
    });

    await tx.abEvent.create({
      data: {
        tenantId,
        eventType: 'expense.draft_recorded',
        actor: 'agent',
        action: {
          expense_id: exp.id,
          amountCents: ocr.amount_cents,
          vendor: ocr.vendor,
          categoryId,
          source,
          confidence: ocr.confidence,
          categorySource,
          categoryConfidence,
        },
      },
    });

    return exp;
  });

  return {
    id: expense.id,
    categoryId,
    vendorName: expense.vendor?.name || ocr.vendor,
    categorySource,
    categoryConfidence,
  };
}

/**
 * Conversational state stored under AbUserMemory key
 * "telegram:active_expense" — the most recent expense the bot recorded
 * for this tenant. Used by both the inline-keyboard callbacks and the
 * natural-language follow-up handler ("it's business", "should be Travel"...).
 */
const ACTIVE_EXPENSE_KEY = 'telegram:active_expense';

async function setActiveExpense(tenantId: string, expenseId: string): Promise<void> {
  const value = JSON.stringify({ expenseId, setAt: Date.now() });
  await db.abUserMemory.upsert({
    where: { tenantId_key: { tenantId, key: ACTIVE_EXPENSE_KEY } },
    update: { value, lastUsed: new Date() },
    create: { tenantId, key: ACTIVE_EXPENSE_KEY, value, type: 'pending_action', confidence: 1 },
  });
}

interface ActiveExpense {
  id: string;
  amountCents: number;
  currency: string;
  date: Date;
  description: string | null;
  vendorName: string | null;
  categoryName: string | null;
  isPersonal: boolean;
  status: string;
}

async function getActiveExpense(tenantId: string): Promise<ActiveExpense | null> {
  const memory = await db.abUserMemory.findUnique({
    where: { tenantId_key: { tenantId, key: ACTIVE_EXPENSE_KEY } },
  });
  if (!memory) return null;
  let expenseId: string | undefined;
  try {
    expenseId = (JSON.parse(memory.value) as { expenseId?: string }).expenseId;
  } catch {
    return null;
  }
  if (!expenseId) return null;

  const expense = await db.abExpense.findFirst({
    where: { id: expenseId, tenantId },
    include: { vendor: { select: { name: true } } },
  });
  if (!expense) return null;

  let categoryName: string | null = null;
  if (expense.categoryId) {
    const cat = await db.abAccount.findUnique({
      where: { id: expense.categoryId },
      select: { name: true },
    });
    categoryName = cat?.name ?? null;
  }

  return {
    id: expense.id,
    amountCents: expense.amountCents,
    currency: expense.currency,
    date: expense.date,
    description: expense.description,
    vendorName: expense.vendor?.name ?? null,
    categoryName,
    isPersonal: expense.isPersonal,
    status: expense.status,
  };
}

function formatExpenseSummary(e: ActiveExpense, leadLine: string): string {
  const lines: string[] = [leadLine, ''];
  if (e.vendorName) lines.push(`• Vendor: <b>${escHtml(e.vendorName)}</b>`);
  lines.push(`• Amount: <b>${fmtUsd(e.amountCents)} ${e.currency}</b>`);
  lines.push(`• Date: ${e.date.toISOString().slice(0, 10)}`);
  lines.push(`• Category: <b>${e.categoryName ? escHtml(e.categoryName) : '—'}</b>`);
  lines.push(`• Type: ${e.isPersonal ? '🏠 Personal' : '💼 Business'}`);
  lines.push(`• Status: ${e.status === 'confirmed' ? '✅ Confirmed' : e.status === 'rejected' ? '❌ Rejected' : '⚠️ Draft — not on the books yet'}`);
  return lines.join('\n');
}

interface CreatedOcrExpense {
  id: string;
  categoryId: string | null;
  vendorName: string | null;
  categorySource: 'vendor_default' | 'pattern' | null;
  categoryConfidence: number | null;
}

/**
 * Build the user-facing reply for a freshly-OCR'd receipt that's still
 * a draft. Surfaces:
 *   • OCR confidence honestly when below 80%
 *   • Where the category came from (vendor default vs. learned pattern)
 *     and how confident I am
 *   • Tax / tip if present
 *   • A clear ask to confirm — the receipt is NOT on the books yet
 */
function buildDraftReceiptReply(
  active: ActiveExpense,
  ocr: ReceiptOcrResult,
  expense: CreatedOcrExpense,
): string {
  const ocrConf = Math.round(ocr.confidence * 100);
  const vendorPhrase = active.vendorName ? `<b>${escHtml(active.vendorName)}</b>` : '<b>this one</b>';
  const amountPhrase = `<b>${fmtUsd(active.amountCents)} ${active.currency}</b>`;

  let lead: string;
  if (active.categoryName) {
    const catNote =
      expense.categorySource === 'vendor_default'
        ? `(your default category for ${active.vendorName ? escHtml(active.vendorName) : 'this vendor'})`
        : expense.categorySource === 'pattern' && expense.categoryConfidence !== null
          ? `(I'm ~${Math.round(expense.categoryConfidence * 100)}% sure based on past entries)`
          : '';
    lead = `📒 <b>Draft receipt</b> — ${vendorPhrase} for ${amountPhrase} under <b>${escHtml(active.categoryName)}</b> ${catNote}.\n\nThis isn't on the books yet. Tap ✅ to confirm, or tell me anything that needs fixing — "actually that's personal", "should be Meals", "wrong amount", etc.`;
  } else {
    lead = `📒 <b>Draft receipt</b> — ${vendorPhrase} for ${amountPhrase} on ${active.date.toISOString().slice(0, 10)}.\n\nI need a category before I book it. Tap 📁 below or just tell me — "Fuel", "Meals", "Office", "should be Travel".`;
  }

  const extras: string[] = [];
  if (ocr.tax_cents) extras.push(`• Tax: ${fmtUsd(ocr.tax_cents)}`);
  if (ocr.tip_cents) extras.push(`• Tip: ${fmtUsd(ocr.tip_cents)}`);
  if (ocrConf < 80) {
    extras.push(`• ⚠️ OCR confidence: ${ocrConf}% — double-check the amount`);
  } else {
    extras.push(`• OCR confidence: ${ocrConf}%`);
  }

  return formatExpenseSummary(active, lead) + '\n' + extras.join('\n');
}

/**
 * Unified review batch: walk the user through everything that needs
 * attention. Two queues, presented in this priority order:
 *
 *   1. AI-suggested categorizations (from the daily auto-categorizer's
 *      medium-confidence pile) — show with [✅ Yes] [📁 Different]
 *      buttons because we already have a guess.
 *   2. Draft expenses that aren't even categorized yet (status =
 *      pending_review, categoryId = null) — show with [📁 Pick category]
 *      [🏠 Personal] [❌ Reject] so the user can sort them quickly.
 *
 * The two lists deliberately use different buttons so the flow is
 * unambiguous; both update the books exactly the same way as the
 * normal photo-handler buttons.
 */
interface ReplyableCtx {
  reply: (text: string, opts?: { parse_mode?: 'HTML'; reply_markup?: { inline_keyboard: { text: string; callback_data: string }[][] } }) => Promise<unknown>;
}

async function sendPendingReviewBatch(tenantId: string, ctx: ReplyableCtx): Promise<number> {
  const aiItems = await getPendingSuggestions(tenantId);

  // Pull EVERY pending_review draft for this tenant — both the ones with
  // a category already auto-applied (just need confirmation) and the
  // ones without a category yet (need a pick + confirmation). The
  // confirmation-gate change (gap 1) means every receipt sits here
  // until the user explicitly approves it.
  const drafts = await db.abExpense.findMany({
    where: { tenantId, status: 'pending_review' },
    include: { vendor: { select: { name: true } } },
    orderBy: { date: 'desc' },
    take: 25,
  });

  // The two queues can overlap (an AI suggestion is itself a
  // pending_review draft). Don't double-show.
  const aiIds = new Set(aiItems.map((i) => i.expenseId));
  const draftsOnly = drafts.filter((d) => !aiIds.has(d.id));

  const total = aiItems.length + draftsOnly.length;
  if (total === 0) {
    await ctx.reply('🎉 All caught up — nothing in the review queue.');
    return 0;
  }

  // Resolve category names for any drafts that already have a category
  // assigned, so the user sees what auto-applied.
  const draftCatIds = [
    ...new Set(draftsOnly.map((d) => d.categoryId).filter((id): id is string => Boolean(id))),
  ];
  const draftCatRows = draftCatIds.length > 0
    ? await db.abAccount.findMany({
        where: { id: { in: draftCatIds } },
        select: { id: true, name: true },
      })
    : [];
  const draftCatNameById = new Map(draftCatRows.map((c) => [c.id, c.name]));

  // Header sets expectation about what's coming.
  const sections: string[] = [];
  if (aiItems.length > 0) sections.push(`<b>${aiItems.length}</b> AI-suggested`);
  const withCat = draftsOnly.filter((d) => d.categoryId).length;
  const noCat = draftsOnly.length - withCat;
  if (withCat > 0) sections.push(`<b>${withCat}</b> awaiting confirmation`);
  if (noCat > 0) sections.push(`<b>${noCat}</b> needing a category`);

  await ctx.reply(
    `📂 Walking you through <b>${total}</b> item${total === 1 ? '' : 's'} in the review queue (${sections.join(' + ')}). Tap a button or just tell me what to do.`,
    { parse_mode: 'HTML' },
  );

  // 1) AI-suggested first — quickest because we already have a guess.
  for (const it of aiItems) {
    const conf = Math.round(it.confidence * 100);
    const date = new Date(it.date).toISOString().slice(0, 10);
    const text = `<b>${escHtml(it.vendorName || 'Expense')}</b> — <b>${fmtUsd(it.amountCents)}</b> · ${date}\n`
      + `I think this is <b>${escHtml(it.suggestedCategoryName)}</b> (~${conf}% sure).`
      + (it.reason ? `\n<i>${escHtml(it.reason)}</i>` : '');
    await ctx.reply(text, {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [[
          { text: '✅ Yes — book it', callback_data: `aiok:${it.expenseId}` },
          { text: '📁 Different', callback_data: `aichg:${it.expenseId}` },
        ]],
      },
    });
  }

  // 2) Plain drafts — split UX by whether a category is already attached.
  for (const d of draftsOnly) {
    const date = d.date.toISOString().slice(0, 10);
    const vendor = d.vendor?.name || d.description || 'Expense';
    if (d.categoryId) {
      const catName = draftCatNameById.get(d.categoryId) || 'category';
      const text =
        `<b>${escHtml(vendor)}</b> — <b>${fmtUsd(d.amountCents)}</b> · ${date}\n`
        + `Auto-categorized as <b>${escHtml(catName)}</b>. Confirm to put it on the books.`;
      await ctx.reply(text, {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [
              { text: '✅ Confirm — book it', callback_data: `confirm:${d.id}` },
              { text: '📁 Change category', callback_data: `change_cat:${d.id}` },
            ],
            [
              { text: d.isPersonal ? '💼 Make business' : '🏠 Make personal', callback_data: `${d.isPersonal ? 'business' : 'personal'}:${d.id}` },
              { text: '❌ Reject', callback_data: `reject:${d.id}` },
            ],
          ],
        },
      });
    } else {
      const text =
        `<b>${escHtml(vendor)}</b> — <b>${fmtUsd(d.amountCents)}</b> · ${date}\n`
        + `<i>Draft, no category yet.</i>`;
      await ctx.reply(text, {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [
              { text: '📁 Pick category', callback_data: `change_cat:${d.id}` },
              { text: '🏠 Personal', callback_data: `personal:${d.id}` },
            ],
            [
              { text: '❌ Reject', callback_data: `reject:${d.id}` },
            ],
          ],
        },
      });
    }
  }

  return total;
}

/**
 * Transcribe a voice note via Gemini's audio-input support. Returns
 * the verbatim text or null if the API isn't configured / fails.
 */
async function transcribeVoiceWithGemini(audioUrl: string, mimeType: string): Promise<string | null> {
  const cfg = await getGeminiKey();
  if (!cfg) return null;
  let audioPart: { inlineData: { mimeType: string; data: string } };
  try {
    const audioRes = await fetch(audioUrl);
    if (!audioRes.ok) return null;
    const buf = await audioRes.arrayBuffer();
    if (buf.byteLength > 18_000_000) return null;
    audioPart = {
      inlineData: { mimeType, data: Buffer.from(buf).toString('base64') },
    };
  } catch {
    return null;
  }
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${cfg.modelVision}:generateContent?key=${cfg.apiKey}`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: 'Transcribe this voice note exactly as spoken. Return ONLY the spoken words, no preamble, no commentary.' }],
        },
        contents: [{ role: 'user', parts: [audioPart, { text: 'Transcribe.' }] }],
        generationConfig: { maxOutputTokens: 500, temperature: 0.0 },
      }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    return text.trim() || null;
  } catch {
    return null;
  }
}

/**
 * Surface a currency-mismatch warning when the receipt was issued in a
 * different currency than the tenant's books. Real conversion is left
 * for a future Plaid/FX integration; today we just call attention to it
 * so the user knows the books amount won't match the bank statement.
 */
function currencyMismatchNote(
  receiptCurrency: string,
  tenantCurrency: string | null,
): string | null {
  if (!tenantCurrency) return null;
  if (receiptCurrency.toUpperCase() === tenantCurrency.toUpperCase()) return null;
  return `Note: receipt is in ${receiptCurrency.toUpperCase()} but your books run in ${tenantCurrency.toUpperCase()}. I've stored the original amount; bank reconciliation will need the converted figure.`;
}

/**
 * ── Daily-briefing setup dialog ────────────────────────────────────────
 *
 * Multi-turn flow stored in AbUserMemory[telegram:digest_setup_state]:
 *   step 'time'     — ask preferred time of day
 *   step 'sections' — ask what to include
 *   step 'preview'  — show a sample digest, ask for tweaks
 *   step 'tuning'   — apply free-form feedback, loop until "good"
 *
 * Bridge functions live in lib/agentbook-digest-prefs.ts.
 */

async function beginSetup(tenantId: string, ctx: ReplyableCtx): Promise<void> {
  const existing = await getDigestPrefs(tenantId);
  const draft: DigestPrefs = { ...existing, setupComplete: false };
  await setSetupState(tenantId, { step: 'time', draft, startedAt: Date.now() });
  await ctx.reply(
    `⚙️ <b>Let's set up your daily briefing.</b>\n\nWhat time would you like it? Say something like "7am", "morning", or "8:30".\n\n<i>(Say "cancel" any time to stop.)</i>`,
    { parse_mode: 'HTML' },
  );
}

async function handleSetupTurn(
  tenantId: string,
  text: string,
  state: SetupState,
  ctx: ReplyableCtx,
): Promise<void> {
  const lower = text.toLowerCase().trim();
  if (/^(cancel|stop|abort|never mind|nvm|quit)\b/.test(lower)) {
    await clearSetupState(tenantId);
    await ctx.reply('Cancelled. Your briefing prefs are unchanged.');
    return;
  }

  if (state.step === 'time') {
    const t = parseTimeString(text);
    if (!t) {
      await ctx.reply('I didn\'t catch a time there. Try "7am", "morning", "8:30", or just a number 0–23.');
      return;
    }
    state.draft.hour = t.hour;
    state.draft.minute = t.minute;
    state.step = 'sections';
    await setSetupState(tenantId, state);
    const sectionList = [
      'cash on hand',
      'yesterday\'s flow',
      'pending review',
      'overdue invoices',
      'this week schedule',
      'anomaly alerts',
      'tax deadline countdown',
      'tax planning tips',
      'cash-flow tips',
      'auto-categorizer summary',
    ];
    await ctx.reply(
      `Got it — <b>${formatTime(t.hour, t.minute)}</b>.\n\nWhat should I include? Reply <b>all</b> for everything, or list what to keep/skip:\n\n${sectionList.map((s) => `• ${s}`).join('\n')}\n\n<i>e.g. "all", "skip anomalies", "no tips", "everything but auto-categorizer".</i>`,
      { parse_mode: 'HTML' },
    );
    return;
  }

  if (state.step === 'sections') {
    if (/^(all|everything|all of (it|them))\b/.test(lower)) {
      state.draft.sections = { ...DEFAULT_PREFS.sections };
    } else if (/^(none|nothing)\b/.test(lower)) {
      state.draft.sections = {
        cashOnHand: false, yesterday: false, pendingReview: false,
        overdue: false, thisWeek: false, anomalies: false,
        taxDeadline: false, taxTips: false, cashFlowTips: false,
        autoCategorize: false,
      };
    } else {
      // Use the same delta-from-feedback logic to interpret the list.
      const result = await applyFeedbackToPrefs(state.draft, text);
      state.draft = result.updated;
    }
    state.step = 'preview';
    await setSetupState(tenantId, state);
    await ctx.reply(
      `Preview of your briefing:\n\n${formatPrefsSummary(state.draft)}\n\nWant to <b>see a sample</b>, <b>tweak</b> something, or save? Reply "preview", anything to tweak, or "good" to lock it in.`,
      { parse_mode: 'HTML' },
    );
    return;
  }

  if (state.step === 'preview' || state.step === 'tuning') {
    if (/^(preview|sample|show me|see it)\b/.test(lower)) {
      // Force-fire the digest cron with the draft prefs by saving them
      // temporarily — easier than threading a "preview prefs" through.
      // We save+test+restore in one shot.
      const saved = state.draft;
      await setDigestPrefs(tenantId, { ...saved, setupComplete: false });
      const url = `${getSelfBaseUrl()}/api/v1/agentbook/cron/morning-digest?hour=now`;
      try {
        await fetch(url, {
          headers: process.env.CRON_SECRET ? { Authorization: `Bearer ${process.env.CRON_SECRET}` } : {},
        });
      } catch {
        // Even if the cron self-call fails, the user just hasn't seen
        // the preview — they can keep tuning.
      }
      state.step = 'tuning';
      await setSetupState(tenantId, state);
      await ctx.reply(
        '☝️ Sample sent above. Reply with feedback to tune ("shorter", "skip cash flow tips", "move to 8am") or "good" to lock it in.',
      );
      return;
    }

    if (/^(good|great|perfect|done|save|looks good|that('?s| is) it|sgtm|👍|✅)\b/.test(lower)) {
      const finalPrefs: DigestPrefs = { ...state.draft, setupComplete: true };
      await setDigestPrefs(tenantId, finalPrefs);
      await clearSetupState(tenantId);
      await ctx.reply(
        `✅ <b>Locked in.</b> Your briefing will arrive at ${formatTime(finalPrefs.hour, finalPrefs.minute)} every morning.\n\nReply to any future briefing with "shorter", "skip X", "move to Y" — I'll keep tuning.`,
        { parse_mode: 'HTML' },
      );
      return;
    }

    // Anything else → treat as tuning feedback.
    const result = await applyFeedbackToPrefs(state.draft, text);
    state.draft = result.updated;
    state.step = 'tuning';
    await setSetupState(tenantId, state);
    if (result.explanations.length > 0) {
      await ctx.reply(
        `🔧 ${result.explanations.join(' ')}\n\nUpdated:\n${formatPrefsSummary(state.draft)}\n\nReply again to keep tuning, or "good" to lock it in.`,
        { parse_mode: 'HTML' },
      );
    } else {
      await ctx.reply(
        'I didn\'t catch a tweak there. Try "shorter", "skip cash flow tips", "move to 8am", "preview", or "good".',
      );
    }
    return;
  }
}

/**
 * Used to detect post-digest free-form replies as feedback (vs. unrelated
 * conversation). Looks for the vocabulary the digest uses — section
 * names, time changes, tone words.
 */
function isPlausibleDigestFeedback(lower: string): boolean {
  if (/^(shorter|longer|brief|concise|detail|verbose|terse)\b/.test(lower)) return true;
  if (/^(skip|drop|hide|don'?t (?:show|include)|no more|less|remove)\b/.test(lower)) return true;
  if (/^(add|include|show|with|more)\b/.test(lower)) return true;
  if (/^(move (?:it|the briefing) to|change.*to|send.*at)\b/.test(lower)) return true;
  if (/^briefing\s+(time|prefs|settings)\b/.test(lower)) return true;
  return false;
}

function getSelfBaseUrl(): string {
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return process.env.NEXTAUTH_URL || 'https://a3book.brainliber.com';
}

/**
 * Render the duplicate-detection reply: tell the user this looks like an
 * existing expense and offer three paths — attach the new receipt to
 * the existing record (most common case for "I already booked this"),
 * keep both as separate expenses (real same-day repeats), or reject.
 */
async function sendDuplicateReply(
  ctx: ReplyableCtx,
  draftId: string,
  active: ActiveExpense,
  dup: DuplicateCandidate,
): Promise<void> {
  const newDate = active.date.toISOString().slice(0, 10);
  const dupDate = dup.date.toISOString().slice(0, 10);
  const sameDate = newDate === dupDate;
  const sameAmount = active.amountCents === dup.amountCents;

  const lines: string[] = [];
  lines.push(`🪄 <b>Looks like a duplicate.</b>`);
  lines.push('');
  lines.push(
    `I already have <b>${escHtml(dup.vendorName || active.vendorName || 'an expense')}</b> for <b>${fmtUsd(dup.amountCents)}</b> on ${dupDate}${dup.status === 'confirmed' ? ' (booked)' : ' (draft)'}${dup.hasReceipt ? ', with a receipt' : ', no receipt yet'}.`,
  );
  if (!sameDate || !sameAmount) {
    const diffs: string[] = [];
    if (!sameDate) diffs.push(`new one is dated ${newDate}`);
    if (!sameAmount) diffs.push(`new amount is ${fmtUsd(active.amountCents)}`);
    lines.push(`<i>(small differences — ${diffs.join(', ')})</i>`);
  }
  lines.push('');
  if (dup.hasReceipt) {
    lines.push(`Pick whether to attach this receipt to the existing record (replaces the old one), keep both as separate expenses, or reject this draft.`);
  } else {
    lines.push(`Want to attach the new receipt to that existing record, or keep both as separate expenses?`);
  }

  await ctx.reply(lines.join('\n'), {
    parse_mode: 'HTML',
    reply_markup: {
      inline_keyboard: [
        [
          { text: '🔗 Attach receipt to existing', callback_data: `attach:${draftId}:${dup.id}` },
        ],
        [
          { text: '✅ Keep both — book it anyway', callback_data: `keepboth:${draftId}` },
          { text: '❌ Reject draft', callback_data: `reject:${draftId}` },
        ],
      ],
    },
  });
}

/**
 * High-confidence duplicate detection — only fires when vendor + amount
 * + date are all close enough to be suspicious. Conservative on purpose
 * (don't pester the user about real same-day repeats):
 *
 *   • vendor: normalizedName must match EXACTLY (no fuzzy)
 *   • amount: within ±50¢ (covers tax-rounding edge cases)
 *   • date: within ±2 days (bank date can lag receipt date)
 *   • not the new draft itself
 *   • the candidate is currently a non-rejected expense
 *
 * Returns the closest match or null. Used to let the user attach the
 * fresh receipt to the existing record instead of double-booking.
 */
interface DuplicateCandidate {
  id: string;
  vendorName: string | null;
  amountCents: number;
  date: Date;
  status: string;
  hasReceipt: boolean;
}

async function findPotentialDuplicate(
  tenantId: string,
  newExpenseId: string,
  vendorId: string | null,
  amountCents: number,
  date: Date,
): Promise<DuplicateCandidate | null> {
  if (!vendorId) return null;
  const dayWindow = 2 * 86_400_000;
  const dollarWindow = 50;
  const candidates = await db.abExpense.findMany({
    where: {
      tenantId,
      vendorId,
      id: { not: newExpenseId },
      status: { notIn: ['rejected'] },
      date: {
        gte: new Date(date.getTime() - dayWindow),
        lte: new Date(date.getTime() + dayWindow),
      },
      amountCents: {
        gte: amountCents - dollarWindow,
        lte: amountCents + dollarWindow,
      },
    },
    include: { vendor: { select: { name: true } } },
    orderBy: { date: 'desc' },
    take: 5,
  });
  if (candidates.length === 0) return null;
  // Pick the closest by combined date + amount distance.
  candidates.sort((a, b) => {
    const distA = Math.abs(a.amountCents - amountCents) + Math.abs(a.date.getTime() - date.getTime()) / 86_400_000;
    const distB = Math.abs(b.amountCents - amountCents) + Math.abs(b.date.getTime() - date.getTime()) / 86_400_000;
    return distA - distB;
  });
  const best = candidates[0];
  return {
    id: best.id,
    vendorName: best.vendor?.name || null,
    amountCents: best.amountCents,
    date: best.date,
    status: best.status,
    hasReceipt: !!best.receiptUrl,
  };
}

/**
 * Anomaly detection: flag a freshly-created expense that's > 3x the
 * tenant's 90-day average for the same category. A great accountant
 * notices these out loud, not in a quarterly report. (Gap 16)
 */
async function buildAnomalyNote(tenantId: string, categoryId: string | null, amountCents: number): Promise<string | null> {
  if (!categoryId) return null;
  const ninetyDaysAgo = new Date(Date.now() - 90 * 86_400_000);
  const peers = await db.abExpense.findMany({
    where: {
      tenantId,
      categoryId,
      isPersonal: false,
      date: { gte: ninetyDaysAgo },
      status: { in: ['confirmed', 'pending_review'] },
      NOT: { amountCents },
    },
    select: { amountCents: true },
    take: 100,
  });
  if (peers.length < 3) return null;
  const avg = peers.reduce((s, e) => s + e.amountCents, 0) / peers.length;
  if (avg <= 0) return null;
  const ratio = amountCents / avg;
  if (ratio < 3) return null;
  return `📈 This is ~${ratio.toFixed(1)}× your typical spend in this category (avg ≈ ${fmtUsd(Math.round(avg))}). Take a second look before confirming.`;
}

/**
 * Recurring-pattern detection: when this vendor has 3+ recent charges
 * within 10% of each other and there's no AbRecurringRule yet, suggest
 * one. Surfacing at the moment of recording makes the user say yes
 * before they forget. (Gap 18)
 */
async function buildRecurringSuggestionNote(tenantId: string, vendorId: string | null): Promise<string | null> {
  if (!vendorId) return null;
  const existing = await db.abRecurringRule.findFirst({
    where: { tenantId, vendorId, active: true },
  });
  if (existing) return null;
  const sixMonthsAgo = new Date(Date.now() - 180 * 86_400_000);
  const peers = await db.abExpense.findMany({
    where: {
      tenantId,
      vendorId,
      isPersonal: false,
      date: { gte: sixMonthsAgo },
      status: 'confirmed',
    },
    select: { amountCents: true, date: true },
    orderBy: { date: 'asc' },
  });
  if (peers.length < 3) return null;
  const avg = peers.reduce((s, e) => s + e.amountCents, 0) / peers.length;
  if (avg <= 0) return null;
  const allClose = peers.every((p) => Math.abs(p.amountCents - avg) / avg < 0.1);
  if (!allClose) return null;
  return `🔁 I've seen ${peers.length} similar charges from this vendor over the last 6 months. Want me to set up a recurring expense rule? (Reply "set up recurring" to do it.)`;
}

/**
 * Bank-reconciliation prompt: if there's a pending AbBankTransaction
 * within the same date/amount window, this receipt is probably for it.
 * On confirm we'd ideally link them; for now we flag it so the user
 * knows we noticed. (Gap 17)
 */
async function buildBankMatchNote(tenantId: string, amountCents: number, date: Date): Promise<string | null> {
  const window = 2 * 86_400_000;
  const lo = Math.round(amountCents * 0.95);
  const hi = Math.round(amountCents * 1.05);
  const match = await db.abBankTransaction.findFirst({
    where: {
      tenantId,
      matchStatus: 'pending',
      amount: { gte: lo, lte: hi },
      date: { gte: new Date(date.getTime() - window), lte: new Date(date.getTime() + window) },
    },
    select: { date: true, name: true, merchantName: true },
  });
  if (!match) return null;
  const label = match.merchantName || match.name;
  return `🔗 This matches a pending bank charge from ${match.date.toISOString().slice(0, 10)}${label ? ` (${escHtml(label)})` : ''} — I'll link them on confirm.`;
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

// === Invoice-from-chat (PR 1) ============================================
//
// Memory keys:
//   • telegram:pending_invoice_draft:<token>  — parsed fields awaiting a
//     client pick (ambiguous resolution).
//   • telegram:invoice_draft:<draftId>        — context for follow-ups
//     (e.g. the chatId for the edit flow).
//   • telegram:editing_invoice:<chatId>       — edit-state machine:
//     `{ draftId, awaiting: 'field' | 'value', field?: 'amount'|'dueDate' }`.

interface DraftCreated {
  kind: 'draft_created';
  draftId: string;
  invoiceNumber: string;
  clientName: string;
  clientEmail: string | null;
  totalCents: number;
  currency: string;
  dueDate: string;
  issuedDate: string;
  lines: Array<{ description: string; rateCents: number; quantity: number; amountCents: number }>;
}

interface AmbiguousClient {
  kind: 'ambiguous';
  clientNameHint: string;
  candidates: Array<{ id: string; name: string; email: string | null }>;
  parsed: unknown;
}

interface NeedsClarify {
  kind: 'needs_clarify';
  question: string;
}

type InvoiceStepData = DraftCreated | AmbiguousClient | NeedsClarify;

function fmtMoney(cents: number, currency: string): string {
  return `${currency === 'USD' ? '$' : currency + ' '}${(cents / 100).toLocaleString('en-US', { maximumFractionDigits: 2, minimumFractionDigits: cents % 100 === 0 ? 0 : 2 })}`;
}

function shortDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function buildDraftPreviewText(d: DraftCreated): string {
  const lines: string[] = [];
  const total = fmtMoney(d.totalCents, d.currency);
  lines.push(`📒 <b>Draft ready</b> — ${escHtml(d.invoiceNumber)}.`);
  lines.push(`Net-30, due <b>${shortDate(d.dueDate)}</b>, <b>${total}</b> to <b>${escHtml(d.clientName)}</b>.`);
  if (d.lines.length > 1) {
    lines.push('');
    lines.push('<i>Line items:</i>');
    for (const l of d.lines) {
      lines.push(`• ${escHtml(l.description || '—')}: ${fmtMoney(l.amountCents, d.currency)}`);
    }
  }
  lines.push('');
  lines.push('Send it?');
  return lines.join('\n');
}

function draftKeyboard(draftId: string) {
  return {
    inline_keyboard: [
      [{ text: '📨 Send now', callback_data: `inv_send:${draftId}` }],
      [{ text: '✏️ Edit', callback_data: `inv_edit:${draftId}` }],
      [{ text: '❌ Cancel', callback_data: `inv_cancel:${draftId}` }],
    ],
  };
}

/**
 * Build the inline keyboard for the ambiguous-client picker.
 * Telegram's `callback_data` cap is 64 bytes — `inv_pickclient:<token>:<uuid>`
 * is 15 + 10 + 1 + 36 = 62, comfortably under.
 */
function pickerKeyboard(token: string, candidates: Array<{ id: string; name: string }>) {
  const rows: { text: string; callback_data: string }[][] = candidates.slice(0, MAX_PICKER_CANDIDATES).map((c) => [
    { text: c.name, callback_data: `inv_pickclient:${token}:${c.id}` },
  ]);
  rows.push([{ text: '❌ Cancel', callback_data: `inv_pickcancel:${token}` }]);
  return { inline_keyboard: rows };
}

/** Cap the picker candidate list — both the inline keyboard rows and
 *  the "Which X did you mean — A or B or C" question text. */
const MAX_PICKER_CANDIDATES = 6;

interface InvoiceReplyCtx {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  reply: (text: string, opts?: any) => Promise<unknown>;
}

async function renderInvoiceCreateResult(
  tenantId: string,
  ctx: InvoiceReplyCtx,
  result: { success: boolean; data?: unknown; error?: string } | undefined,
): Promise<void> {
  if (!result || !result.success || !result.data) {
    await ctx.reply(result?.error || "Couldn't draft that invoice — try again with a client name and amount.");
    return;
  }
  const data = result.data as InvoiceStepData;

  if (data.kind === 'needs_clarify') {
    await ctx.reply(`🤔 ${data.question}`);
    return;
  }

  if (data.kind === 'ambiguous') {
    // Stash parsed fields under a short token so the picker callback can
    // re-issue the create with the picked clientId.
    const token = randomToken();
    const memoryKey = `telegram:pending_invoice_draft:${token}`;
    const memoryValue = JSON.stringify({ parsed: data.parsed, setAt: Date.now() });
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

    // Truncate to MAX_PICKER_CANDIDATES (6) — long candidate lists blow
    // past Telegram's text-message length when interpolated inline.
    const shown = data.candidates.slice(0, MAX_PICKER_CANDIDATES);
    const namesText = shown.map((c) => escHtml(c.name)).join(' or ');
    const overflow = data.candidates.length - shown.length;
    const suffix = overflow > 0 ? ` (and ${overflow} more)` : '';

    await ctx.reply(
      `Which ${escHtml(data.clientNameHint)} did you mean — ${namesText}${suffix}?`,
      { parse_mode: 'HTML', reply_markup: pickerKeyboard(token, data.candidates) },
    );
    return;
  }

  // Happy path — single client matched, draft is created.
  const text = buildDraftPreviewText(data);
  await ctx.reply(text, {
    parse_mode: 'HTML',
    reply_markup: draftKeyboard(data.draftId),
  });
}

function randomToken(): string {
  // 10 chars hex (40 bits of CSPRNG entropy) — keeps `inv_pickclient:<token>:<uuid>`
  // (15 + 10 + 1 + 36 = 62 bytes) safely under Telegram's 64-byte
  // callback_data cap. Math.random is not cryptographically random and
  // a same-second collision under load could cross-route picks.
  return randomBytes(5).toString('hex');
}

// === Timer + invoice-from-timer (PR 2) ====================================
//
// Memory keys:
//   • telegram:pending_timer_start:<token>  — pending /timer start
//     awaiting an ambiguous-client pick (mirrors PR 1's pattern).
//   • telegram:pending_invoice_from_timer:<token>  — pending invoice-
//     from-timer awaiting a client pick.
//
// Callback prefixes:
//   • tmr_pickclient:<token>:<clientId>   pick the client for a /timer start
//   • tmr_pickcancel:<token>              cancel a /timer start pick
//   • tmr_pickinvoice:<token>:<clientId>  pick the client for invoice-from-timer
//   • tmr_pickinvoicecancel:<token>       cancel an invoice-from-timer pick
//
// Send/Edit/Cancel for the resulting draft reuses PR 1's `inv_*` callbacks
// — the draft lives in `AbInvoice` exactly the same way.

// Telegram-flavoured "Xh Ymin" string. The frontend's Timer.tsx uses a
// different format ("Xh Ym"), so we deliberately keep the two helpers
// separate rather than sharing a single utility.
function fmtMinutes(min: number): string {
  if (!min || min <= 0) return '0min';
  const m = Math.round(min);
  const hours = Math.floor(m / 60);
  const mins = m % 60;
  if (hours === 0) return `${mins}min`;
  if (mins === 0) return `${hours}h`;
  return `${hours}h ${mins}min`;
}

interface TimerStartedData {
  kind: 'started' | 'needs_picker';
  entryId?: string;
  clientId?: string | null;
  clientName?: string | null;
  clientNameHint?: string | null;
  taskDescription?: string;
  candidates?: Array<{ id: string; name: string }>;
  unmatchedClientHint?: string | null;
}
interface TimerStoppedData {
  kind: 'stopped' | 'not_running';
  minutesLogged?: number;
  weekTotalMinutes?: number;
  clientName?: string | null;
  description?: string;
}
interface TimerStatusData {
  kind: 'running' | 'idle';
  elapsedMinutes?: number;
  description?: string;
  clientName?: string | null;
  todayTotalMinutes?: number;
}

function timerPickerKeyboard(token: string, candidates: Array<{ id: string; name: string }>) {
  const rows: { text: string; callback_data: string }[][] = candidates
    .slice(0, MAX_PICKER_CANDIDATES)
    .map((c) => [{ text: c.name, callback_data: `tmr_pickclient:${token}:${c.id}` }]);
  rows.push([{ text: '❌ Cancel', callback_data: `tmr_pickcancel:${token}` }]);
  return { inline_keyboard: rows };
}

function timerInvoicePickerKeyboard(token: string, candidates: Array<{ id: string; name: string }>) {
  const rows: { text: string; callback_data: string }[][] = candidates
    .slice(0, MAX_PICKER_CANDIDATES)
    .map((c) => [{ text: c.name, callback_data: `tmr_pickinvoice:${token}:${c.id}` }]);
  rows.push([{ text: '❌ Cancel', callback_data: `tmr_pickinvoicecancel:${token}` }]);
  return { inline_keyboard: rows };
}

async function renderTimerStepResult(
  tenantId: string,
  ctx: InvoiceReplyCtx,
  intent: 'start_timer' | 'stop_timer' | 'timer_status',
  result: { success: boolean; data?: unknown; error?: string } | undefined,
): Promise<void> {
  if (!result || !result.success || !result.data) {
    await ctx.reply(result?.error || "Couldn't reach the timer — try again.");
    return;
  }

  if (intent === 'start_timer') {
    const data = result.data as TimerStartedData;
    if (data.kind === 'needs_picker') {
      // Stash the pending start so the picker callback can re-issue it
      // with the chosen clientId.
      const token = randomToken();
      const memoryKey = `telegram:pending_timer_start:${token}`;
      const memoryValue = JSON.stringify({
        clientNameHint: data.clientNameHint,
        taskDescription: data.taskDescription,
        setAt: Date.now(),
      });
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
      const cands = data.candidates || [];
      const namesText = cands.slice(0, MAX_PICKER_CANDIDATES).map((c) => escHtml(c.name)).join(' or ');
      await ctx.reply(
        `Which ${escHtml(data.clientNameHint || 'client')} did you mean — ${namesText}?`,
        { parse_mode: 'HTML', reply_markup: timerPickerKeyboard(token, cands) },
      );
      return;
    }
    // Started.
    const target = data.clientName ? escHtml(data.clientName) : (data.clientNameHint ? escHtml(data.clientNameHint) : 'this task');
    let line = `⏱ Timer started for <b>${target}</b>.`;
    if (data.taskDescription && data.taskDescription !== 'Working') {
      line += ` Logging "${escHtml(data.taskDescription)}".`;
    }
    if (data.unmatchedClientHint && !data.clientId) {
      line += ` (Heads up: I don't have a client called "${escHtml(data.unmatchedClientHint)}" on file — add them and I'll bind it.)`;
    }
    line += '\n\nType /timer stop when done.';
    await ctx.reply(line, { parse_mode: 'HTML' });
    return;
  }

  if (intent === 'stop_timer') {
    const data = result.data as TimerStoppedData;
    if (data.kind === 'not_running') {
      await ctx.reply('No active timer.');
      return;
    }
    const target = data.clientName ? escHtml(data.clientName) : (data.description ? escHtml(data.description) : 'this task');
    const logged = fmtMinutes(data.minutesLogged || 0);
    const week = fmtMinutes(data.weekTotalMinutes || 0);
    const reply = `⏹ Stopped — <b>${logged}</b> logged for <b>${target}</b>. Total this week: <b>${week}</b>.`;
    await ctx.reply(reply, { parse_mode: 'HTML' });
    return;
  }

  if (intent === 'timer_status') {
    const data = result.data as TimerStatusData;
    const today = fmtMinutes(data.todayTotalMinutes || 0);
    if (data.kind === 'idle') {
      await ctx.reply(`No timer running. Today's total: <b>${today}</b>.`, { parse_mode: 'HTML' });
      return;
    }
    const target = data.clientName ? escHtml(data.clientName) : 'this task';
    const desc = data.description ? ` (${escHtml(data.description)})` : '';
    const elapsed = fmtMinutes(data.elapsedMinutes || 0);
    await ctx.reply(
      `⏱ Running for <b>${target}</b>${desc} — <b>${elapsed}</b> so far. Today's total: <b>${today}</b>.`,
      { parse_mode: 'HTML' },
    );
    return;
  }
}

interface InvoiceFromTimerDraftData {
  kind: 'draft_created';
  draftId: string;
  invoiceNumber: string;
  clientName: string;
  clientEmail: string | null;
  totalCents: number;
  currency: string;
  dueDate: string;
  issuedDate: string;
  entryCount: number;
  totalMinutes: number;
  headlineRateCents: number | null;
  lineCount: number;
  entryIdsConsumed: string[];
}
interface InvoiceFromTimerAmbiguousData {
  kind: 'ambiguous';
  clientNameHint: string;
  candidates: Array<{ id: string; name: string; email: string | null }>;
  dateHint: string;
}
interface InvoiceFromTimerNoEntries {
  kind: 'no_entries';
  clientName: string;
  dateHint: string;
}
interface InvoiceFromTimerNeedsClarify {
  kind: 'needs_clarify';
  question: string;
}

async function renderInvoiceFromTimerResult(
  tenantId: string,
  ctx: InvoiceReplyCtx,
  result: { success: boolean; data?: unknown; error?: string } | undefined,
): Promise<void> {
  if (!result || !result.success || !result.data) {
    await ctx.reply(result?.error || "Couldn't generate that invoice — try again.");
    return;
  }
  const data = result.data as
    | InvoiceFromTimerDraftData
    | InvoiceFromTimerAmbiguousData
    | InvoiceFromTimerNoEntries
    | InvoiceFromTimerNeedsClarify;

  if (data.kind === 'needs_clarify') {
    await ctx.reply(`🤔 ${data.question}`);
    return;
  }
  if (data.kind === 'no_entries') {
    await ctx.reply(
      `No unbilled time for <b>${escHtml(data.clientName)}</b> ${escHtml(data.dateHint)}. Track a few hours first, then ask again.`,
      { parse_mode: 'HTML' },
    );
    return;
  }
  if (data.kind === 'ambiguous') {
    const token = randomToken();
    const memoryKey = `telegram:pending_invoice_from_timer:${token}`;
    const memoryValue = JSON.stringify({
      clientNameHint: data.clientNameHint,
      dateHint: data.dateHint,
      setAt: Date.now(),
    });
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
    const namesText = data.candidates.slice(0, MAX_PICKER_CANDIDATES).map((c) => escHtml(c.name)).join(' or ');
    await ctx.reply(
      `Which ${escHtml(data.clientNameHint)} did you mean — ${namesText}?`,
      {
        parse_mode: 'HTML',
        reply_markup: timerInvoicePickerKeyboard(token, data.candidates),
      },
    );
    return;
  }

  // Happy path — draft created.
  const totalHours = (data.totalMinutes / 60);
  const hoursLabel = totalHours.toLocaleString('en-US', { maximumFractionDigits: 2 });
  const rateLabel = data.headlineRateCents
    ? `${fmtMoney(data.headlineRateCents, data.currency)}/hr`
    : 'varied rates';
  const total = fmtMoney(data.totalCents, data.currency);
  const text =
    `📒 ${data.entryCount} ${data.entryCount === 1 ? 'entry' : 'entries'} · `
    + `<b>${hoursLabel}h</b> × ${rateLabel} = <b>${total}</b>.\n`
    + `Draft <b>${escHtml(data.invoiceNumber)}</b> ready for <b>${escHtml(data.clientName)}</b> — net-30, due <b>${shortDate(data.dueDate)}</b>.\n\n`
    + `Send it?`;
  await ctx.reply(text, { parse_mode: 'HTML', reply_markup: draftKeyboard(data.draftId) });
}

// ─── Mileage (PR 4) ────────────────────────────────────────────────────
interface MileageRecordedData {
  kind: 'recorded';
  entryId: string;
  miles: number;
  unit: 'mi' | 'km';
  purpose: string;
  clientName: string | null;
  clientNameHint: string | null;
  jurisdiction: 'us' | 'ca';
  ratePerUnitCents: number;
  deductibleAmountCents: number;
  rateReason: string;
  journalPosted: boolean;
}

async function renderMileageStepResult(
  _tenantId: string,
  ctx: InvoiceReplyCtx,
  result: { success: boolean; data?: unknown; error?: string } | undefined,
): Promise<void> {
  if (!result || !result.success || !result.data) {
    await ctx.reply(result?.error || "Couldn't record that trip — try again.");
    return;
  }
  const data = result.data as MileageRecordedData;
  const target = data.clientName
    ? escHtml(data.clientName)
    : data.clientNameHint
      ? escHtml(data.clientNameHint)
      : escHtml(data.purpose || 'this trip');
  const dollars = (data.deductibleAmountCents / 100).toLocaleString(
    data.jurisdiction === 'ca' ? 'en-CA' : 'en-US',
    { style: 'currency', currency: data.jurisdiction === 'ca' ? 'CAD' : 'USD' },
  );
  const rateLabel = data.jurisdiction === 'ca' ? 'CRA rate' : 'IRS std rate';
  const lines: string[] = [
    `📒 ${data.miles} ${data.unit} to ${target} = <b>${dollars}</b> deductible (${rateLabel}). On the books.`,
  ];
  if (!data.journalPosted) {
    lines.push("(Couldn't find a Vehicle Expense / Owner's Equity account in your chart — saved the entry but skipped the journal. Seed the chart of accounts and edit me to repost.)");
  }
  await ctx.reply(lines.join('\n'), {
    parse_mode: 'HTML',
    reply_markup: {
      inline_keyboard: [[
        { text: '✏️ Edit miles', callback_data: `mlg_edit:${data.entryId}` },
      ]],
    },
  });
}

// Lazy-initialize bot (cold start optimization for serverless)
let bot: Bot | null = null;

function getBot(): Bot {
  if (bot) return bot;

  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN not set');

  bot = new Bot(token);

  if (E2E_CAPTURE) {
    // Install a grammy API transformer — intercepts every bot.api.* call
    // (including ctx.reply / ctx.replyWithHTML / ctx.answerCallbackQuery, which
    // delegate through bot.api). Direct property assignment doesn't survive
    // grammy's internal method routing, so this is the supported path.
    bot.api.config.use(async (prev, method, payload, signal) => {
      if (method === 'sendMessage' && currentCapture) {
        const p = payload as { chat_id: number | string; text: string };
        currentCapture.push({ chatId: p.chat_id, text: p.text, payload });
        return {
          ok: true,
          result: { message_id: 0, date: Math.floor(Date.now() / 1000), chat: { id: Number(p.chat_id), type: 'private' as const }, text: p.text },
        } as any;
      }
      if (method === 'getMe') {
        return {
          ok: true,
          result: {
            id: 1, is_bot: true, first_name: 'E2E Bot', username: 'e2e_bot',
            can_join_groups: false, can_read_all_group_messages: false, supports_inline_queries: false,
          },
        } as any;
      }
      if (method === 'getFile') {
        const p = payload as { file_id: string };
        return { ok: true, result: { file_id: p.file_id, file_unique_id: p.file_id, file_size: 1024, file_path: 'e2e/fixture.jpg' } } as any;
      }
      if (method === 'answerCallbackQuery' || method === 'editMessageText' || method === 'editMessageReplyMarkup') {
        return { ok: true, result: true } as any;
      }
      // Unhandled methods would hit Telegram with a fake token in capture mode.
      // Return an ok-shaped stub instead of letting them 404.
      if (currentCapture) {
        return { ok: true, result: true } as any;
      }
      return prev(method, payload, signal);
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

    // ── Daily-briefing setup + feedback dialog ──────────────────────────
    // If the user is mid-setup, EVERY text goes through the setup flow
    // until they save or cancel.
    {
      const ongoingSetup = await getSetupState(tenantId);
      if (ongoingSetup) {
        await handleSetupTurn(tenantId, text, ongoingSetup, ctx);
        return;
      }
      // Triggers for starting setup.
      if (
        /^(set ?up|configure|customi[sz]e|tune|change)\b.*\b(briefing|digest|morning|daily)\b/i.test(lower)
        || /^(briefing|digest)\s+(setup|prefs|preferences|settings)\b/i.test(lower)
        || lower === 'setup briefing'
        || lower === 'set up briefing'
      ) {
        await beginSetup(tenantId, ctx);
        return;
      }
      // After-the-fact tuning: feedback on a previously-saved briefing.
      const prefs = await getDigestPrefs(tenantId);
      if (prefs.setupComplete && isPlausibleDigestFeedback(lower)) {
        const result = await applyFeedbackToPrefs(prefs, text);
        if (result.satisfied) {
          await ctx.reply('👍 Saved. Tomorrow\'s briefing will look the same as today\'s.');
          return;
        }
        if (result.explanations.length > 0) {
          await setDigestPrefs(tenantId, result.updated);
          await ctx.reply(
            `🔧 Got it — ${result.explanations.join(' ')}\n\nNext briefing: <b>${formatTime(result.updated.hour, result.updated.minute)}</b>, <b>${result.updated.tone}</b> tone. Reply again to keep tuning, or "good" to lock it in.`,
            { parse_mode: 'HTML' },
          );
          return;
        }
      }
    }

    // ── Invoice edit-state machine (PR 1) ───────────────────────────────
    // If the user previously tapped ✏️ Edit on a draft invoice, the
    // next 1–2 messages drive the edit. Scope cap: amount + due date
    // only; client and lines land in a follow-up PR.
    {
      const editKey = `telegram:editing_invoice:${ctx.chat.id}`;
      const editMem = await db.abUserMemory.findUnique({
        where: { tenantId_key: { tenantId, key: editKey } },
      });
      if (editMem) {
        let parsedEdit: { draftId?: string; awaiting?: 'field' | 'value'; field?: 'amount' | 'dueDate' } = {};
        try { parsedEdit = JSON.parse(editMem.value); } catch { /* fall through */ }
        if (parsedEdit.draftId && parsedEdit.awaiting === 'field') {
          const fieldNorm = lower.replace(/\W/g, '');
          let field: 'amount' | 'dueDate' | null = null;
          if (/^amount|total|price/i.test(lower) || fieldNorm === 'amount') field = 'amount';
          else if (/^due|^date|duedate/i.test(lower) || /^when/i.test(lower)) field = 'dueDate';
          if (field) {
            await db.abUserMemory.update({
              where: { tenantId_key: { tenantId, key: editKey } },
              data: {
                value: JSON.stringify({ draftId: parsedEdit.draftId, awaiting: 'value', field, setAt: Date.now() }),
                lastUsed: new Date(),
              },
            });
            // Item 8: when the draft has >1 line, the amount-edit path
            // proportionally rebases each line. Surface that explicitly
            // up front instead of silently doing it — per-line edit
            // lands in PR 2.
            let prompt: string;
            if (field === 'amount') {
              const lineCount = await db.abInvoiceLine.count({ where: { invoiceId: parsedEdit.draftId } });
              prompt = lineCount > 1
                ? "What's the new total? (e.g. <code>$5500</code>)\n\n<i>Note: this rebalances each line proportionally. Per-line edit ships in the next release.</i>"
                : "What's the new total? (e.g. <code>$5500</code>)";
            } else {
              prompt = "What's the new due date? (e.g. <code>2026-06-30</code>)";
            }
            await ctx.reply(prompt, { parse_mode: 'HTML' });
            return;
          }
          // Unknown field name — clear the state and let the user start fresh.
          await db.abUserMemory.deleteMany({ where: { tenantId, key: editKey } });
          await ctx.reply("I didn't catch that — try <b>amount</b> or <b>due date</b>. Tap ✏️ Edit again to retry.", { parse_mode: 'HTML' });
          return;
        }
        if (parsedEdit.draftId && parsedEdit.awaiting === 'value' && parsedEdit.field) {
          const draft = await db.abInvoice.findFirst({
            where: { id: parsedEdit.draftId, tenantId },
            include: { client: { select: { name: true } } },
          });
          if (!draft || draft.status !== 'draft') {
            await db.abUserMemory.deleteMany({ where: { tenantId, key: editKey } });
            await ctx.reply("That draft is no longer editable.");
            return;
          }
          if (parsedEdit.field === 'amount') {
            const m = text.match(/\$?\s*([\d,]+(?:\.\d{1,2})?)\s*(K|k)?/);
            const n = m ? parseFloat(m[1].replace(/,/g, '')) : NaN;
            if (!m || !isFinite(n) || n <= 0) {
              await ctx.reply('I need a positive dollar amount. Try <code>$5500</code>.', { parse_mode: 'HTML' });
              return;
            }
            const newTotal = Math.round((m[2] ? n * 1000 : n) * 100);
            // Cap at $10B (1e12 cents). Above this we leave Number's
            // safe-integer range and the proportional-rebalance math
            // below silently produces wrong line amounts.
            const MAX_INVOICE_CENTS = 1_000_000_000_000;
            if (!Number.isFinite(newTotal) || newTotal <= 0 || newTotal > MAX_INVOICE_CENTS) {
              await ctx.reply('That amount looks off — try again with a smaller number?');
              return;
            }
            // Distribute across existing lines proportionally; if a single
            // line, just replace its rate.
            const lines = await db.abInvoiceLine.findMany({ where: { invoiceId: draft.id } });
            await db.$transaction(async (tx) => {
              if (lines.length === 1) {
                await tx.abInvoiceLine.update({
                  where: { id: lines[0].id },
                  data: { rateCents: newTotal, amountCents: Math.round((lines[0].quantity || 1) * newTotal) },
                });
              } else if (lines.length > 1) {
                const oldTotal = lines.reduce((s, l) => s + l.amountCents, 0);
                if (oldTotal > 0) {
                  for (const l of lines) {
                    const ratio = l.amountCents / oldTotal;
                    const newAmount = Math.round(newTotal * ratio);
                    await tx.abInvoiceLine.update({
                      where: { id: l.id },
                      data: { rateCents: Math.round(newAmount / (l.quantity || 1)), amountCents: newAmount },
                    });
                  }
                }
              }
              await tx.abInvoice.update({
                where: { id: draft.id },
                data: { amountCents: newTotal },
              });
            });
            await db.abUserMemory.deleteMany({ where: { tenantId, key: editKey } });
            await ctx.reply(
              `📒 Updated <b>${escHtml(draft.number)}</b> total → <b>${fmtUsd(newTotal)}</b>. Send it?`,
              {
                parse_mode: 'HTML',
                reply_markup: draftKeyboard(draft.id),
              },
            );
            return;
          }
          if (parsedEdit.field === 'dueDate') {
            const trimmed = text.trim();
            const parsedDate = new Date(trimmed);
            if (isNaN(parsedDate.getTime())) {
              await ctx.reply('I couldn\'t read that date. Try <code>2026-06-30</code> or <code>July 30</code>.', { parse_mode: 'HTML' });
              return;
            }
            // Bound to [issuedDate, issuedDate + 5 years] so a typo like
            // 9999-12-31 doesn't land as the actual due date and break
            // every aging report downstream.
            const FIVE_YEARS_MS = 5 * 365 * 24 * 60 * 60 * 1000;
            const issuedTs = draft.issuedDate.getTime();
            if (parsedDate.getTime() < issuedTs || parsedDate.getTime() > issuedTs + FIVE_YEARS_MS) {
              await ctx.reply("That date doesn't look right — try YYYY-MM-DD or 'in 30 days'.");
              return;
            }
            await db.abInvoice.update({
              where: { id: draft.id },
              data: { dueDate: parsedDate },
            });
            await db.abUserMemory.deleteMany({ where: { tenantId, key: editKey } });
            await ctx.reply(
              `📒 Updated <b>${escHtml(draft.number)}</b> due date → <b>${parsedDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</b>. Send it?`,
              {
                parse_mode: 'HTML',
                reply_markup: draftKeyboard(draft.id),
              },
            );
            return;
          }
        }
      }
    }

    // ── Mileage edit follow-up (PR 4) ─────────────────────────────────
    // If the user tapped ✏️ Edit miles on a recorded trip, the next
    // numeric reply patches the entry (which reverses + reposts the JE).
    {
      const mileageEditKey = `telegram:editing_mileage:${ctx.chat.id}`;
      const mlgMem = await db.abUserMemory.findUnique({
        where: { tenantId_key: { tenantId, key: mileageEditKey } },
      });
      if (mlgMem) {
        let parsedMlg: { entryId?: string; setAt?: number } = {};
        try { parsedMlg = JSON.parse(mlgMem.value); } catch { /* fall through */ }
        if (parsedMlg.entryId) {
          // Accept "47", "47 miles", "47 mi", "47.5 km".
          const m = text.match(/^\s*(\d+(?:\.\d+)?)\s*(mi|miles|km|kilometers|kilometres)?\s*$/i);
          if (!m) {
            await ctx.reply('I need a positive number (e.g. <code>47</code>). Tap ✏️ Edit miles again to retry.', { parse_mode: 'HTML' });
            await db.abUserMemory.deleteMany({ where: { tenantId, key: mileageEditKey } });
            return;
          }
          const newMiles = parseFloat(m[1]);
          if (!isFinite(newMiles) || newMiles <= 0) {
            await ctx.reply('Distance has to be positive. Tap ✏️ Edit miles to try again.');
            await db.abUserMemory.deleteMany({ where: { tenantId, key: mileageEditKey } });
            return;
          }
          // Call the shared mileage service in-process. The previous
          // implementation re-entered the PATCH route via fetch with an
          // `x-tenant-id` header — that's a tenant-spoof vector since
          // the route is internet-reachable and the header is the
          // highest-priority tenant resolver. In-process call uses the
          // tenant we already authenticated from the chat-ID mapping.
          try {
            const result = await updateMileageEntry(tenantId, parsedMlg.entryId, {
              miles: newMiles,
            });
            if (!result.ok) {
              await ctx.reply(`Couldn't update that trip — ${result.error}.`);
            } else {
              const data = result.entry;
              const dollars = (data.deductibleAmountCents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
              await ctx.reply(
                `🔧 Updated to ${data.miles} ${data.unit} = <b>${dollars}</b>. Reposted the journal entry.`,
                { parse_mode: 'HTML' },
              );
            }
          } catch (err) {
            console.warn('[mileage edit] patch failed:', err);
            await ctx.reply("Couldn't update that trip — try again in a sec.");
          }
          await db.abUserMemory.deleteMany({ where: { tenantId, key: mileageEditKey } });
          return;
        }
      }
    }

    // Anything that looks like a review request — walk through the
    // unified review queue. Catches all the phrasings users actually
    // type ("give me expenses for review", "show me drafts", "what
    // needs my attention", "let me approve the pending ones", etc.).
    const startsLikeReview =
      /^(review|let me review|let's review|let me see|let me check|let me approve|show me|show|give me|walk me through|go through|check|what(?:'s| is| are| do)|anything|got)\b/i
        .test(lower);
    const mentionsPending =
      /\b(review|pending|draft|to (?:review|approve|confirm|categori[sz]e)|need(?:s)? (?:a )?(?:review|category|approval|attention|confirmation)|approve|attention|expenses? (?:for|to|that need|needing)|drafts?|uncategori[sz]ed)\b/i
        .test(lower);
    if (
      /^review\b/i.test(lower)
      || /^show (?:me )?pending\b/i.test(lower)
      || /^pending\b/i.test(lower)
      || (startsLikeReview && mentionsPending)
    ) {
      await sendPendingReviewBatch(tenantId, ctx);
      return;
    }

    // "categorize" / "auto-categorize now" → run the auto-categorizer
    // on demand instead of waiting for the morning cron.
    if (/^(auto[\- ]?)?categori[sz]e( now| my expenses)?$/i.test(lower)) {
      const result = await autoCategorizeForTenant(tenantId, { force: true });
      const lines: string[] = [];
      if (result.appliedCount > 0) {
        lines.push(`📁 Auto-categorized <b>${result.appliedCount}</b> expense${result.appliedCount === 1 ? '' : 's'}.`);
      }
      if (result.pending.length > 0) {
        lines.push(`🤔 <b>${result.pending.length}</b> need${result.pending.length === 1 ? 's' : ''} a quick check — type <code>review</code> to walk through them.`);
      }
      if (result.skippedCount > 0 && result.appliedCount === 0 && result.pending.length === 0) {
        lines.push(`Nothing I can categorize automatically. ${result.skippedCount} expense${result.skippedCount === 1 ? '' : 's'} need manual category.`);
      }
      if (lines.length === 0) {
        lines.push('🎉 All expenses already categorized — nothing to do.');
      }
      await ctx.reply(lines.join('\n'), { parse_mode: 'HTML' });
      return;
    }

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

    // Run the bot's intent → plan → review → execute → evaluate loop.
    // The loop handles confirm / reject / business / personal / categorize /
    // the four queries / help directly. record_expense and unrelated bubble
    // up via evaluation.delegatedToBrain so the agent brain takes over.
    if (!sessionAction) {
      try {
        const active = await getActiveExpense(tenantId);
        const categories = await db.abAccount.findMany({
          where: { tenantId, accountType: 'expense', isActive: true },
          select: { id: true, name: true, code: true },
        });
        const botCtx: BotContext = {
          tenantId,
          active: active as BotActive | null,
          categories,
        };
        const loop = await runAgentLoop(text, botCtx);

        // Invoice-from-chat: render the friendly draft preview / picker
        // here. The bot agent owns the DB write; the webhook owns the
        // keyboard and final user-facing copy.
        if (
          loop.evaluation.needsKeyboard
          && loop.intent.intent === 'create_invoice_from_chat'
        ) {
          await renderInvoiceCreateResult(tenantId, ctx, loop.results[0]);
          return;
        }

        // Timer flow (PR 2): same handoff — bot writes the DB row, the
        // webhook builds the friendly reply + (for invoice-from-timer)
        // the Send/Edit/Cancel keyboard.
        if (
          loop.evaluation.needsKeyboard
          && (loop.intent.intent === 'start_timer'
            || loop.intent.intent === 'stop_timer'
            || loop.intent.intent === 'timer_status')
        ) {
          await renderTimerStepResult(tenantId, ctx, loop.intent.intent, loop.results[0]);
          return;
        }
        if (
          loop.evaluation.needsKeyboard
          && loop.intent.intent === 'invoice_from_timer'
        ) {
          await renderInvoiceFromTimerResult(tenantId, ctx, loop.results[0]);
          return;
        }
        if (
          loop.evaluation.needsKeyboard
          && loop.intent.intent === 'record_mileage'
        ) {
          await renderMileageStepResult(tenantId, ctx, loop.results[0]);
          return;
        }

        if (loop.evaluation.reply) {
          try {
            await ctx.reply(loop.evaluation.reply, {
              parse_mode: loop.evaluation.parseMode,
            });
          } catch {
            await ctx.reply(loop.evaluation.reply);
          }
        }
        if (!loop.evaluation.delegatedToBrain) return;
        // Fall through to agent brain for record_expense / queries / unrelated.
      } catch (err) {
        console.warn('[telegram/agent-loop] failed:', err);
      }
    }

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

  // === Voice notes → Gemini transcription → same intent flow as text ===
  bot.on('message:voice', async (ctx) => {
    const tenantId = await resolveTenantId(ctx.chat.id);
    await ctx.reply('🎙️ One sec — listening to your note…');

    let text: string | null = null;
    try {
      const file = await ctx.api.getFile(ctx.message.voice.file_id);
      const url = `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${file.file_path}`;
      const mime = ctx.message.voice.mime_type || 'audio/ogg';
      text = await transcribeVoiceWithGemini(url, mime);
    } catch (err) {
      console.error('[telegram/voice] failed:', err);
    }

    if (!text) {
      await ctx.reply('Couldn\'t transcribe that — try again or type the message out.');
      return;
    }

    await ctx.reply(`📝 I heard: "<i>${escHtml(text)}</i>"`, { parse_mode: 'HTML' });

    // Route the transcribed text through the same intent → plan → execute
    // flow as a typed message. Run the agent loop first, then fall back to
    // the agent brain if the loop delegates.
    try {
      const active = await getActiveExpense(tenantId);
      const categories = await db.abAccount.findMany({
        where: { tenantId, accountType: 'expense', isActive: true },
        select: { id: true, name: true, code: true },
      });
      const botCtx: BotContext = {
        tenantId,
        active: active as BotActive | null,
        categories,
      };
      const loop = await runAgentLoop(text, botCtx);
      if (loop.evaluation.reply) {
        try {
          await ctx.reply(loop.evaluation.reply, { parse_mode: loop.evaluation.parseMode });
        } catch {
          await ctx.reply(loop.evaluation.reply);
        }
      }
      if (!loop.evaluation.delegatedToBrain) return;

      // Delegated → agent brain
      const result = await callAgentBrain(tenantId, text, undefined, undefined, undefined);
      if (result.success && result.data) {
        const reply: string = formatResponse(result.data);
        try {
          await ctx.reply(reply, { parse_mode: 'HTML' });
        } catch {
          await ctx.reply(result.data.message || reply);
        }
      } else {
        await ctx.reply('Got the note but I\'m not sure what to do with it. Try saying it differently?');
      }
    } catch (err) {
      console.error('[telegram/voice/process] failed:', err);
      await ctx.reply('Heard the note but couldn\'t act on it. Try typing the same thing.');
    }
  });

  // === Photo messages → Receipt OCR ===
  bot.on('message:photo', async (ctx) => {
    const tenantId = await resolveTenantId(ctx.chat.id);
    const photos = ctx.message.photo;
    const best = photos[photos.length - 1];
    await ctx.reply('📒 One sec — reading your receipt…');

    try {
      const file = await ctx.api.getFile(best.file_id);
      const telegramUrl = `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${file.file_path}`;
      const permanentUrl = await persistReceiptBlob(telegramUrl, tenantId, 'image/jpeg');

      const ocr = await ocrReceipt(permanentUrl, 'image/jpeg');
      if (!ocr) {
        await ctx.reply('I saved the photo but the OCR step came back empty — either the image is unreadable or my Gemini key isn\'t set. Type the expense in plain English ("Spent $45 on lunch at Starbucks") and I\'ll book it.');
        return;
      }
      if (ocr.amount_cents === 0) {
        await ctx.reply('I read the image but couldn\'t pin down the total. Try a clearer photo, or just type it ("Spent $45 on gas at Shell"). I\'ll figure out the rest.');
        return;
      }

      const expense = await createOcrExpense(tenantId, ocr, permanentUrl, 'telegram_photo');
      await setActiveExpense(tenantId, expense.id);

      const active = await getActiveExpense(tenantId);
      if (!active) {
        await ctx.reply('Saved the receipt but I lost track of it. Type "expenses" to see it.');
        return;
      }

      const tenantConfig = await db.abTenantConfig.findUnique({
        where: { userId: tenantId },
        select: { currency: true },
      });
      const expenseRow = await db.abExpense.findUnique({
        where: { id: expense.id },
        select: { vendorId: true, date: true },
      });

      // Duplicate check FIRST — if this looks like a dup, give the user
      // a one-tap path to attach the receipt to the existing record
      // instead of double-booking.
      const dup = await findPotentialDuplicate(
        tenantId,
        expense.id,
        expenseRow?.vendorId ?? null,
        active.amountCents,
        expenseRow?.date ?? active.date,
      );
      if (dup) {
        await sendDuplicateReply(ctx, expense.id, active, dup);
        return;
      }

      const [fxNote, anomalyNote, recurringNote, bankMatchNote] = await Promise.all([
        Promise.resolve(currencyMismatchNote(ocr.currency, tenantConfig?.currency || null)),
        buildAnomalyNote(tenantId, expense.categoryId, active.amountCents),
        buildRecurringSuggestionNote(tenantId, expenseRow?.vendorId ?? null),
        buildBankMatchNote(tenantId, active.amountCents, expenseRow?.date ?? active.date),
      ]);
      const insightLines: string[] = [];
      if (fxNote) insightLines.push(`💱 ${fxNote}`);
      if (anomalyNote) insightLines.push(anomalyNote);
      if (bankMatchNote) insightLines.push(bankMatchNote);
      if (recurringNote) insightLines.push(recurringNote);
      const draftReply = buildDraftReceiptReply(active, ocr, expense)
        + (insightLines.length ? '\n\n' + insightLines.join('\n') : '');

      await ctx.reply(draftReply, {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [
              { text: '✅ Looks right — book it', callback_data: `confirm:${expense.id}` },
              { text: '📁 Change category', callback_data: `change_cat:${expense.id}` },
            ],
            [
              { text: active.isPersonal ? '💼 Make business' : '🏠 Make personal', callback_data: `${active.isPersonal ? 'business' : 'personal'}:${expense.id}` },
              { text: '❌ Not real', callback_data: `reject:${expense.id}` },
            ],
          ],
        },
      });
    } catch (err) {
      console.error('[telegram/photo] failed:', err);
      await ctx.reply('Sorry — couldn\'t process that receipt. Try a clearer photo or type the expense in plain English.');
    }
  });

  bot.on('message:document', async (ctx) => {
    const tenantId = await resolveTenantId(ctx.chat.id);
    const doc = ctx.message.document;
    const mimeType = doc.mime_type || '';
    if (!mimeType.includes('pdf') && !mimeType.includes('image')) {
      await ctx.reply('I can read PDF or image receipts. Send one of those or just type the expense in plain English.');
      return;
    }
    await ctx.reply(`📄 One sec — reading ${doc.file_name || 'that document'}…`);

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
      await setActiveExpense(tenantId, expense.id);

      const active = await getActiveExpense(tenantId);
      if (!active) {
        await ctx.reply('Document saved but I lost track of it. Type "expenses" to see it.');
        return;
      }

      const tenantConfig = await db.abTenantConfig.findUnique({
        where: { userId: tenantId },
        select: { currency: true },
      });
      const expenseRow = await db.abExpense.findUnique({
        where: { id: expense.id },
        select: { vendorId: true, date: true },
      });

      const dup = await findPotentialDuplicate(
        tenantId,
        expense.id,
        expenseRow?.vendorId ?? null,
        active.amountCents,
        expenseRow?.date ?? active.date,
      );
      if (dup) {
        await sendDuplicateReply(ctx, expense.id, active, dup);
        return;
      }

      const [fxNote, anomalyNote, recurringNote, bankMatchNote] = await Promise.all([
        Promise.resolve(currencyMismatchNote(ocr.currency, tenantConfig?.currency || null)),
        buildAnomalyNote(tenantId, expense.categoryId, active.amountCents),
        buildRecurringSuggestionNote(tenantId, expenseRow?.vendorId ?? null),
        buildBankMatchNote(tenantId, active.amountCents, expenseRow?.date ?? active.date),
      ]);
      const insightLines: string[] = [];
      if (fxNote) insightLines.push(`💱 ${fxNote}`);
      if (anomalyNote) insightLines.push(anomalyNote);
      if (bankMatchNote) insightLines.push(bankMatchNote);
      if (recurringNote) insightLines.push(recurringNote);
      const draftReply = buildDraftReceiptReply(active, ocr, expense)
        + (insightLines.length ? '\n\n' + insightLines.join('\n') : '');

      await ctx.reply(draftReply, {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [
              { text: '✅ Looks right — book it', callback_data: `confirm:${expense.id}` },
              { text: '📁 Change category', callback_data: `change_cat:${expense.id}` },
            ],
            [
              { text: active.isPersonal ? '💼 Make business' : '🏠 Make personal', callback_data: `${active.isPersonal ? 'business' : 'personal'}:${expense.id}` },
              { text: '❌ Not real', callback_data: `reject:${expense.id}` },
            ],
          ],
        },
      });
    } catch (err) {
      console.error('[telegram/document] failed:', err);
      await ctx.reply('Sorry, I couldn\'t process that document. Try sending it as a photo or type it in plain English.');
    }
  });

  bot.on('callback_query:data', async (ctx) => {
    const cbData = ctx.callbackQuery.data;
    try {
      const tenantId = ctx.chat?.id ? await resolveTenantId(ctx.chat.id) : '';
      const parts = cbData.split(':');
      const action = parts[0];

      if (action === 'confirm') {
        const expenseId = await resolveExpenseId(tenantId, parts[1]);
        if (!expenseId) {
          await ctx.answerCallbackQuery({ text: 'No recent expense to confirm' });
          return;
        }
        const expense = await db.abExpense.findFirst({ where: { id: expenseId, tenantId } });
        if (!expense) {
          await ctx.answerCallbackQuery({ text: 'Expense not found' });
          return;
        }

        // Confirmation gate: refuse to book without a category.
        if (!expense.categoryId && !expense.isPersonal) {
          await ctx.answerCallbackQuery({ text: 'Need a category first' });
          await ctx.reply('I can\'t book this without a category — tap 📁 below or tell me one ("Fuel", "Meals", "Office Expenses").');
          return;
        }

        let journalEntryId = expense.journalEntryId;
        let categoryAccount: { id: string; name: string; taxCategory: string | null } | null = null;
        if (expense.categoryId) {
          categoryAccount = await db.abAccount.findUnique({
            where: { id: expense.categoryId },
            select: { id: true, name: true, taxCategory: true },
          });
        }
        const tenantConfig = await db.abTenantConfig.findUnique({
          where: { userId: tenantId },
          select: { jurisdiction: true, currency: true },
        });
        if (!journalEntryId && expense.categoryId && !expense.isPersonal) {
          const cashAccount = await db.abAccount.findFirst({ where: { tenantId, code: '1000' } });
          if (cashAccount) {
            const je = await db.abJournalEntry.create({
              data: {
                tenantId,
                date: expense.date,
                memo: `Expense: ${expense.description || 'Confirmed expense'}`,
                sourceType: 'expense',
                sourceId: expense.id,
                verified: true,
                lines: {
                  create: [
                    { accountId: expense.categoryId, debitCents: expense.amountCents, creditCents: 0, description: expense.description || 'Expense' },
                    { accountId: cashAccount.id, debitCents: 0, creditCents: expense.amountCents, description: 'Payment' },
                  ],
                },
              },
            });
            journalEntryId = je.id;
          }
        }
        await db.abExpense.update({
          where: { id: expenseId },
          data: { status: 'confirmed', journalEntryId },
        });
        await db.abEvent.create({
          data: {
            tenantId,
            eventType: 'expense.confirmed',
            actor: 'user',
            action: { expenseId: expense.id, source: 'telegram_button' },
          },
        });
        const updated = await getActiveExpense(tenantId);
        await ctx.answerCallbackQuery({ text: '✅ Booked' });

        // Tax-line implication note (gaps 11, 12, 14) — surface deduction
        // rules + ITC eligibility based on category, amount, tax_cents,
        // and jurisdiction.
        const taxNote = categoryAccount
          ? buildTaxNote(
              categoryAccount.name,
              categoryAccount.taxCategory || '',
              expense.amountCents,
              expense.taxAmountCents || 0,
              tenantConfig?.jurisdiction || 'us',
            )
          : '';

        // Pacing (gap 5): post-confirm reply is short — one line + the
        // tax note if any. The user just saw the full summary in the
        // draft message and doesn't need to see it again on confirm.
        const oneLine = updated
          ? `✅ <b>On the books</b> — ${escHtml(updated.vendorName || 'expense')} ${fmtUsd(updated.amountCents)}${updated.categoryName ? ' → <b>' + escHtml(updated.categoryName) + '</b>' : ''}.`
          : '✅ <b>On the books.</b>';
        const reply = taxNote ? `${oneLine}\n\n${taxNote}` : oneLine;
        try {
          await ctx.editMessageText(reply, { parse_mode: 'HTML' });
        } catch {
          await ctx.reply(reply, { parse_mode: 'HTML' });
        }
        return;
      }

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
        try {
          await ctx.editMessageText('❌ Expense rejected — won\'t appear on the books.');
        } catch {
          await ctx.reply('❌ Expense rejected — won\'t appear on the books.');
        }
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
        const updated = await getActiveExpense(tenantId);
        if (updated) {
          try {
            await ctx.editMessageText(formatExpenseSummary(updated, '🏠 Marked as personal — excluded from business books.'), { parse_mode: 'HTML' });
          } catch {
            await ctx.reply(formatExpenseSummary(updated, '🏠 Marked as personal — excluded from business books.'), { parse_mode: 'HTML' });
          }
        }
        return;
      }

      if (action === 'business') {
        const expenseId = await resolveExpenseId(tenantId, parts[1]);
        if (!expenseId) {
          await ctx.answerCallbackQuery({ text: 'No recent expense to update' });
          return;
        }
        await db.abExpense.updateMany({
          where: { id: expenseId, tenantId },
          data: { isPersonal: false },
        });
        await ctx.answerCallbackQuery({ text: '💼 Marked as business' });
        const updated = await getActiveExpense(tenantId);
        if (updated) {
          try {
            await ctx.editMessageText(formatExpenseSummary(updated, '💼 Marked as a business expense.'), { parse_mode: 'HTML' });
          } catch {
            await ctx.reply(formatExpenseSummary(updated, '💼 Marked as a business expense.'), { parse_mode: 'HTML' });
          }
        }
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
        await setActiveExpense(tenantId, expenseId);
        await ctx.answerCallbackQuery({ text: `✅ Categorized as ${account.name}` });
        const updated = await getActiveExpense(tenantId);
        const lead = `✅ Categorized as <b>${escHtml(account.name)}</b>. I'll remember this for future ${expense.vendorId ? 'expenses from this vendor' : 'similar expenses'}.`;
        try {
          if (updated) {
            await ctx.editMessageText(formatExpenseSummary(updated, lead), { parse_mode: 'HTML' });
          } else {
            await ctx.editMessageText(lead, { parse_mode: 'HTML' });
          }
        } catch {
          await ctx.reply(updated ? formatExpenseSummary(updated, lead) : lead, { parse_mode: 'HTML' });
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

      if (action === 'review_drafts') {
        await ctx.answerCallbackQuery({ text: 'Loading review batch…' });
        await sendPendingReviewBatch(tenantId, ctx);
        return;
      }

      if (action === 'setup_briefing') {
        await ctx.answerCallbackQuery({ text: 'Starting setup…' });
        await beginSetup(tenantId, ctx);
        return;
      }

      // attach:<draftId>:<existingId> — move receiptUrl from the new
      // draft onto the existing expense, then delete the draft. The user
      // gets receipt documentation on what's already booked without
      // double-recording the expense.
      if (action === 'attach') {
        const draftId = parts[1];
        const existingId = parts[2];
        if (!draftId || !existingId) {
          await ctx.answerCallbackQuery({ text: 'Bad callback' });
          return;
        }
        const draft = await db.abExpense.findFirst({
          where: { id: draftId, tenantId },
          select: { id: true, receiptUrl: true },
        });
        const existing = await db.abExpense.findFirst({
          where: { id: existingId, tenantId },
          include: { vendor: { select: { name: true } } },
        });
        if (!draft || !existing) {
          await ctx.answerCallbackQuery({ text: 'Records not found' });
          return;
        }
        if (draft.receiptUrl) {
          await db.abExpense.update({
            where: { id: existingId },
            data: { receiptUrl: draft.receiptUrl },
          });
        }
        await db.abExpense.delete({ where: { id: draftId } });
        await db.abEvent.create({
          data: {
            tenantId,
            eventType: 'expense.receipt_attached',
            actor: 'user',
            action: {
              existingExpenseId: existingId,
              droppedDraftId: draftId,
              hadReceiptBefore: !!existing.receiptUrl,
            },
          },
        });
        await db.abUserMemory.deleteMany({
          where: { tenantId, key: 'telegram:active_expense' },
        });
        await ctx.answerCallbackQuery({ text: '🔗 Receipt attached' });
        const vendor = existing.vendor?.name || 'expense';
        const date = existing.date.toISOString().slice(0, 10);
        const reply =
          `🔗 Receipt attached to <b>${escHtml(vendor)}</b> ${fmtUsd(existing.amountCents)} (${date}). Draft dropped — no double-booking.`;
        try {
          await ctx.editMessageText(reply, { parse_mode: 'HTML' });
        } catch {
          await ctx.reply(reply, { parse_mode: 'HTML' });
        }
        return;
      }

      // keepboth:<draftId> — user confirms it's a real separate expense.
      // Show the standard draft confirmation flow now that the dup
      // warning is dismissed.
      if (action === 'keepboth') {
        const draftId = parts[1];
        if (!draftId) {
          await ctx.answerCallbackQuery({ text: 'Bad callback' });
          return;
        }
        await setActiveExpense(tenantId, draftId);
        const updated = await getActiveExpense(tenantId);
        await ctx.answerCallbackQuery({ text: 'Treating as separate' });
        if (!updated) {
          await ctx.reply('Couldn\'t find the draft.');
          return;
        }
        const reply = formatExpenseSummary(
          updated,
          `📒 OK, keeping it as a separate expense. Confirm to book, or change anything you need.`,
        );
        try {
          await ctx.editMessageText(reply, {
            parse_mode: 'HTML',
            reply_markup: {
              inline_keyboard: [
                [
                  { text: '✅ Confirm — book it', callback_data: `confirm:${draftId}` },
                  { text: '📁 Change category', callback_data: `change_cat:${draftId}` },
                ],
                [
                  { text: updated.isPersonal ? '💼 Make business' : '🏠 Make personal', callback_data: `${updated.isPersonal ? 'business' : 'personal'}:${draftId}` },
                  { text: '❌ Reject', callback_data: `reject:${draftId}` },
                ],
              ],
            },
          });
        } catch {
          await ctx.reply(reply, { parse_mode: 'HTML' });
        }
        return;
      }

      // Accept the AI's category suggestion for an expense.
      // Format: aiok:<expenseId>
      if (action === 'aiok') {
        const expenseId = parts[1];
        if (!expenseId) {
          await ctx.answerCallbackQuery({ text: 'Bad callback' });
          return;
        }
        const pending = await getPendingSuggestions(tenantId);
        const suggestion = pending.find((p) => p.expenseId === expenseId);
        if (!suggestion) {
          await ctx.answerCallbackQuery({ text: 'No longer pending' });
          await ctx.editMessageText('✅ Already handled.');
          return;
        }
        // Apply the category + learn the vendor pattern
        const expense = await db.abExpense.findFirst({ where: { id: expenseId, tenantId } });
        if (!expense) {
          await ctx.answerCallbackQuery({ text: 'Expense not found' });
          return;
        }
        await db.abExpense.update({
          where: { id: expenseId },
          data: { categoryId: suggestion.suggestedCategoryId, confidence: 0.95 },
        });
        if (expense.vendorId) {
          const vendor = await db.abVendor.findUnique({ where: { id: expense.vendorId } });
          if (vendor) {
            await db.abPattern.upsert({
              where: { tenantId_vendorPattern: { tenantId, vendorPattern: vendor.normalizedName } },
              update: {
                categoryId: suggestion.suggestedCategoryId,
                confidence: 0.95,
                source: 'user_corrected',
                usageCount: { increment: 1 },
                lastUsed: new Date(),
              },
              create: {
                tenantId,
                vendorPattern: vendor.normalizedName,
                categoryId: suggestion.suggestedCategoryId,
                confidence: 0.95,
                source: 'user_corrected',
              },
            });
            await db.abVendor.update({ where: { id: vendor.id }, data: { defaultCategoryId: suggestion.suggestedCategoryId } });
          }
        }
        const remaining = await dropPendingSuggestion(tenantId, expenseId);
        await ctx.answerCallbackQuery({ text: `✅ Booked under ${suggestion.suggestedCategoryName}` });
        try {
          await ctx.editMessageText(
            `✅ <b>${escHtml(suggestion.vendorName || 'Expense')}</b> ${fmtUsd(suggestion.amountCents)} → <b>${escHtml(suggestion.suggestedCategoryName)}</b>${remaining > 0 ? `\n\n${remaining} left to review.` : '\n\nAll caught up. 🎉'}`,
            { parse_mode: 'HTML' },
          );
        } catch {
          await ctx.reply(`✅ Booked under ${suggestion.suggestedCategoryName}.`);
        }
        return;
      }

      // Override the AI's suggestion: open the same category picker as
      // the regular Change Category flow, but pre-set this expense as
      // active so the cat:<code> callback writes to it.
      if (action === 'aichg') {
        const expenseId = parts[1];
        if (!expenseId) {
          await ctx.answerCallbackQuery({ text: 'Bad callback' });
          return;
        }
        await setActiveExpense(tenantId, expenseId);
        const categories = await db.abAccount.findMany({
          where: { tenantId, accountType: 'expense', isActive: true },
          orderBy: { code: 'asc' },
          select: { id: true, name: true, code: true },
          take: 12,
        });
        if (categories.length === 0) {
          await ctx.answerCallbackQuery({ text: 'No expense categories' });
          return;
        }
        await db.abUserMemory.upsert({
          where: { tenantId_key: { tenantId, key: 'telegram:pending_recategorize' } },
          update: { value: JSON.stringify({ expenseId, setAt: Date.now() }), lastUsed: new Date() },
          create: {
            tenantId,
            key: 'telegram:pending_recategorize',
            value: JSON.stringify({ expenseId, setAt: Date.now() }),
            type: 'pending_action',
            confidence: 1,
          },
        });
        const rows: { text: string; callback_data: string }[][] = [];
        for (let i = 0; i < categories.length; i += 2) {
          rows.push(
            categories.slice(i, i + 2).map((c) => ({
              text: c.name,
              callback_data: `cat:${c.code}`,
            })),
          );
        }
        await ctx.answerCallbackQuery({ text: 'Pick the right one' });
        await ctx.reply('📁 Pick a category:', { reply_markup: { inline_keyboard: rows } });
        return;
      }

      // === Invoice-from-chat (PR 1) ====================================
      if (action === 'inv_send') {
        const draftId = parts[1];
        if (!draftId) { await ctx.answerCallbackQuery({ text: 'Bad callback' }); return; }
        const inv = await db.abInvoice.findFirst({
          where: { id: draftId, tenantId },
          include: { client: { select: { name: true, email: true } } },
        });
        if (!inv) {
          await ctx.answerCallbackQuery({ text: 'Draft not found' });
          return;
        }
        if (inv.status !== 'draft') {
          await ctx.answerCallbackQuery({ text: `Already ${inv.status}` });
          return;
        }

        // Post the AR/Revenue journal entry now (deferred until send so a
        // cancelled draft never touches the books). Then flip status.
        const [arAccount, revenueAccount] = await Promise.all([
          db.abAccount.findUnique({ where: { tenantId_code: { tenantId, code: '1100' } } }),
          db.abAccount.findUnique({ where: { tenantId_code: { tenantId, code: '4000' } } }),
        ]);

        if (!arAccount || !revenueAccount) {
          await ctx.answerCallbackQuery({ text: 'Chart of accounts not seeded' });
          await ctx.reply("❌ Can't post the journal — AR (1100) or Revenue (4000) account is missing. Seed your chart of accounts first.");
          return;
        }

        try {
          await db.$transaction(async (tx) => {
            const je = await tx.abJournalEntry.create({
              data: {
                tenantId,
                date: inv.issuedDate,
                memo: `Invoice ${inv.number} to ${inv.client.name}`,
                sourceType: 'invoice',
                sourceId: inv.id,
                verified: true,
                lines: {
                  create: [
                    { accountId: arAccount.id, debitCents: inv.amountCents, creditCents: 0, description: `AR - Invoice ${inv.number}` },
                    { accountId: revenueAccount.id, debitCents: 0, creditCents: inv.amountCents, description: `Revenue - Invoice ${inv.number}` },
                  ],
                },
              },
            });
            await tx.abInvoice.update({
              where: { id: inv.id },
              data: { status: 'sent', journalEntryId: je.id },
            });
            await tx.abClient.update({
              where: { id: inv.clientId },
              data: { totalBilledCents: { increment: inv.amountCents } },
            });
            await tx.abEvent.create({
              data: {
                tenantId,
                eventType: 'invoice.sent',
                actor: 'user',
                action: { invoiceId: inv.id, number: inv.number, source: 'telegram' },
              },
            });
          });
        } catch (err) {
          console.error('[inv_send] failed:', err);
          await ctx.answerCallbackQuery({ text: 'Send failed' });
          return;
        }

        // Clear any pending edit-state for this chat.
        await db.abUserMemory.deleteMany({
          where: { tenantId, key: `telegram:editing_invoice:${ctx.chat?.id}` },
        });

        await ctx.answerCallbackQuery({ text: '📨 Sent' });
        const recipient = inv.client.email
          ? ` to <b>${escHtml(inv.client.email)}</b>`
          : '';
        const reply = `✅ Sent${recipient} — <b>${escHtml(inv.number)}</b> (${fmtUsd(inv.amountCents)}). I'll ping you when they pay.`;
        try {
          await ctx.editMessageText(reply, { parse_mode: 'HTML' });
        } catch {
          await ctx.reply(reply, { parse_mode: 'HTML' });
        }
        return;
      }

      if (action === 'inv_edit') {
        const draftId = parts[1];
        if (!draftId) { await ctx.answerCallbackQuery({ text: 'Bad callback' }); return; }
        // PR 1 scope cap: edit only supports `amount` and `dueDate` for
        // now. `client` and `lines` will land in a follow-up PR — those
        // require multi-step flows that aren't worth shipping until the
        // happy path is proven.
        const memoryKey = `telegram:editing_invoice:${ctx.chat?.id}`;
        await db.abUserMemory.upsert({
          where: { tenantId_key: { tenantId, key: memoryKey } },
          update: {
            value: JSON.stringify({ draftId, awaiting: 'field', setAt: Date.now() }),
            lastUsed: new Date(),
          },
          create: {
            tenantId,
            key: memoryKey,
            value: JSON.stringify({ draftId, awaiting: 'field', setAt: Date.now() }),
            type: 'pending_action',
            confidence: 1,
          },
        });
        await ctx.answerCallbackQuery({ text: 'Pick a field' });
        await ctx.reply(
          'Which field — <b>amount</b> or <b>due date</b>? (Client and line-item edits land in the next release.)',
          {
            parse_mode: 'HTML',
            reply_markup: {
              inline_keyboard: [[
                { text: 'Amount', callback_data: `inv_editfield:${draftId}:amount` },
                { text: 'Due date', callback_data: `inv_editfield:${draftId}:dueDate` },
              ]],
            },
          },
        );
        return;
      }

      if (action === 'inv_editfield') {
        const draftId = parts[1];
        const field = parts[2];
        if (!draftId || !['amount', 'dueDate'].includes(field)) {
          await ctx.answerCallbackQuery({ text: 'Bad callback' });
          return;
        }
        const memoryKey = `telegram:editing_invoice:${ctx.chat?.id}`;
        await db.abUserMemory.upsert({
          where: { tenantId_key: { tenantId, key: memoryKey } },
          update: {
            value: JSON.stringify({ draftId, awaiting: 'value', field, setAt: Date.now() }),
            lastUsed: new Date(),
          },
          create: {
            tenantId,
            key: memoryKey,
            value: JSON.stringify({ draftId, awaiting: 'value', field, setAt: Date.now() }),
            type: 'pending_action',
            confidence: 1,
          },
        });
        await ctx.answerCallbackQuery({ text: `Send the new ${field}` });
        const prompt = field === 'amount'
          ? "What's the new total? (e.g. <code>$5500</code> or <code>5500.00</code>)"
          : "What's the new due date? (e.g. <code>2026-06-30</code> or <code>July 30</code>)";
        await ctx.reply(prompt, { parse_mode: 'HTML' });
        return;
      }

      if (action === 'inv_cancel') {
        const draftId = parts[1];
        if (!draftId) { await ctx.answerCallbackQuery({ text: 'Bad callback' }); return; }
        const inv = await db.abInvoice.findFirst({ where: { id: draftId, tenantId } });
        if (!inv) {
          await ctx.answerCallbackQuery({ text: 'Already gone' });
          return;
        }
        if (inv.status !== 'draft') {
          await ctx.answerCallbackQuery({ text: `Cannot cancel — invoice is ${inv.status}` });
          return;
        }
        await db.$transaction([
          db.abInvoiceLine.deleteMany({ where: { invoiceId: draftId } }),
          db.abInvoice.delete({ where: { id: draftId } }),
        ]);
        await db.abUserMemory.deleteMany({
          where: { tenantId, key: `telegram:editing_invoice:${ctx.chat?.id}` },
        });
        await db.abEvent.create({
          data: {
            tenantId,
            eventType: 'invoice.draft_cancelled',
            actor: 'user',
            action: { number: inv.number, source: 'telegram' },
          },
        });
        await ctx.answerCallbackQuery({ text: '❌ Cancelled' });
        try {
          await ctx.editMessageText('Cancelled. Nothing booked.');
        } catch {
          await ctx.reply('Cancelled. Nothing booked.');
        }
        return;
      }

      if (action === 'inv_pickclient') {
        const token = parts[1];
        const clientId = parts[2];
        if (!token || !clientId) { await ctx.answerCallbackQuery({ text: 'Bad callback' }); return; }
        const memoryKey = `telegram:pending_invoice_draft:${token}`;
        const memory = await db.abUserMemory.findUnique({
          where: { tenantId_key: { tenantId, key: memoryKey } },
        });
        if (!memory) {
          await ctx.answerCallbackQuery({ text: 'Pick expired — try again' });
          return;
        }
        let parsed: unknown = null;
        try {
          parsed = (JSON.parse(memory.value) as { parsed?: unknown }).parsed ?? null;
        } catch {
          parsed = null;
        }
        if (!parsed) {
          await ctx.answerCallbackQuery({ text: 'Pick expired — try again' });
          return;
        }
        // Forward to the draft-from-text endpoint with clientId pre-set.
        const baseUrl = getSelfBaseUrl();
        try {
          const res = await fetch(`${baseUrl}/api/v1/agentbook-invoice/invoices/draft-from-text`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-tenant-id': tenantId },
            body: JSON.stringify({ clientId, parsed }),
          });
          const json = await res.json() as { success: boolean; data?: DraftCreated; error?: string };
          await db.abUserMemory.deleteMany({ where: { tenantId, key: memoryKey } });
          if (!json.success || !json.data) {
            await ctx.answerCallbackQuery({ text: 'Failed' });
            await ctx.reply(`❌ ${json.error || 'Could not create draft.'}`);
            return;
          }
          await ctx.answerCallbackQuery({ text: 'Got it' });
          const text = buildDraftPreviewText(json.data);
          try {
            await ctx.editMessageText(text, {
              parse_mode: 'HTML',
              reply_markup: draftKeyboard(json.data.draftId),
            });
          } catch {
            await ctx.reply(text, {
              parse_mode: 'HTML',
              reply_markup: draftKeyboard(json.data.draftId),
            });
          }
        } catch (err) {
          console.error('[inv_pickclient] failed:', err);
          await ctx.answerCallbackQuery({ text: 'Network error' });
        }
        return;
      }

      if (action === 'inv_pickcancel') {
        const token = parts[1];
        if (token) {
          await db.abUserMemory.deleteMany({
            where: { tenantId, key: `telegram:pending_invoice_draft:${token}` },
          });
        }
        await ctx.answerCallbackQuery({ text: 'Cancelled' });
        try {
          await ctx.editMessageText('Cancelled. Nothing booked.');
        } catch {
          await ctx.reply('Cancelled. Nothing booked.');
        }
        return;
      }

      // === Timer pickers (PR 2) =========================================
      // tmr_pickclient: bind a /timer start to the chosen client, then
      // start the entry. Auto-stops any running timer (matches the
      // POST /timer/start behaviour).
      if (action === 'tmr_pickclient') {
        const token = parts[1];
        const clientId = parts[2];
        if (!token || !clientId) { await ctx.answerCallbackQuery({ text: 'Bad callback' }); return; }
        const memoryKey = `telegram:pending_timer_start:${token}`;
        const memory = await db.abUserMemory.findUnique({
          where: { tenantId_key: { tenantId, key: memoryKey } },
        });
        if (!memory) {
          await ctx.answerCallbackQuery({ text: 'Pick expired — try again' });
          return;
        }
        let pending: { taskDescription?: string; clientNameHint?: string } = {};
        try {
          pending = JSON.parse(memory.value) as { taskDescription?: string; clientNameHint?: string };
        } catch {
          pending = {};
        }
        try {
          const client = await db.abClient.findFirst({
            where: { id: clientId, tenantId },
            select: { id: true, name: true },
          });
          if (!client) {
            await ctx.answerCallbackQuery({ text: 'Client missing' });
            await db.abUserMemory.deleteMany({ where: { tenantId, key: memoryKey } });
            return;
          }
          // Auto-stop any running timer.
          const running = await db.abTimeEntry.findFirst({
            where: { tenantId, endedAt: null },
          });
          if (running) {
            const dur = Math.max(1, Math.round((Date.now() - running.startedAt.getTime()) / 60_000));
            await db.abTimeEntry.update({
              where: { id: running.id },
              data: { endedAt: new Date(), durationMinutes: dur },
            });
          }
          await db.abTimeEntry.create({
            data: {
              tenantId,
              clientId: client.id,
              description: pending.taskDescription || 'Working',
              startedAt: new Date(),
            },
          });
          await db.abUserMemory.deleteMany({ where: { tenantId, key: memoryKey } });
          await ctx.answerCallbackQuery({ text: '⏱ Started' });
          const taskNote = pending.taskDescription && pending.taskDescription !== 'Working'
            ? ` Logging "${escHtml(pending.taskDescription)}".`
            : '';
          const reply = `⏱ Timer started for <b>${escHtml(client.name)}</b>.${taskNote}\n\nType /timer stop when done.`;
          try {
            await ctx.editMessageText(reply, { parse_mode: 'HTML' });
          } catch {
            await ctx.reply(reply, { parse_mode: 'HTML' });
          }
        } catch (err) {
          console.warn('[tmr_pickclient] failed:', err);
          await ctx.answerCallbackQuery({ text: 'Timer start failed' });
        }
        return;
      }

      if (action === 'tmr_pickcancel') {
        const token = parts[1];
        if (token) {
          await db.abUserMemory.deleteMany({
            where: { tenantId, key: `telegram:pending_timer_start:${token}` },
          });
        }
        await ctx.answerCallbackQuery({ text: 'Cancelled' });
        try {
          await ctx.editMessageText('Cancelled. No timer running.');
        } catch {
          await ctx.reply('Cancelled. No timer running.');
        }
        return;
      }

      // tmr_pickinvoice: bind an invoice-from-timer to the chosen client.
      if (action === 'tmr_pickinvoice') {
        const token = parts[1];
        const clientId = parts[2];
        if (!token || !clientId) { await ctx.answerCallbackQuery({ text: 'Bad callback' }); return; }
        // Fail closed locally before invoking the HTTP route — same
        // pattern as `tmr_pickclient` above. The route does verify
        // ownership too, but doing the check here keeps the bot from
        // round-tripping a foreign clientId and leaking its existence
        // through a 403 response code.
        const owns = await db.abClient.findFirst({
          where: { id: clientId, tenantId },
          select: { id: true },
        });
        if (!owns) {
          await ctx.answerCallbackQuery({ text: 'Client missing' });
          await ctx.reply("That client isn't available anymore.");
          return;
        }
        const memoryKey = `telegram:pending_invoice_from_timer:${token}`;
        const memory = await db.abUserMemory.findUnique({
          where: { tenantId_key: { tenantId, key: memoryKey } },
        });
        if (!memory) {
          await ctx.answerCallbackQuery({ text: 'Pick expired — try again' });
          return;
        }
        let pending: { dateHint?: string } = {};
        try {
          pending = JSON.parse(memory.value) as { dateHint?: string };
        } catch {
          pending = {};
        }
        try {
          const tenantConfig = await db.abTenantConfig.findUnique({
            where: { userId: tenantId },
            select: { timezone: true },
          });
          const tz = tenantConfig?.timezone || 'UTC';
          const range = parseDateHint(pending.dateHint, tz);
          const baseUrl = getSelfBaseUrl();
          const res = await fetch(`${baseUrl}/api/v1/agentbook-invoice/invoices/from-time-entries`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-tenant-id': tenantId },
            body: JSON.stringify({
              clientId,
              dateRange: { startDate: range.startDate.toISOString(), endDate: range.endDate.toISOString() },
              source: 'telegram',
            }),
          });
          const json = await res.json() as {
            success: boolean;
            data?: {
              invoiceId: string;
              invoiceNumber: string;
              clientName: string;
              totalCents: number;
              currency: string;
              dueDate: string;
              lineCount: number;
              entryIdsConsumed: string[];
            };
            error?: string;
          };
          await db.abUserMemory.deleteMany({ where: { tenantId, key: memoryKey } });
          if (!json.success || !json.data) {
            await ctx.answerCallbackQuery({ text: 'Failed' });
            await ctx.reply(`❌ ${json.error || 'Could not generate invoice.'}`);
            return;
          }
          await ctx.answerCallbackQuery({ text: 'Got it' });
          const total = fmtMoney(json.data.totalCents, json.data.currency);
          const reply =
            `📒 ${json.data.entryIdsConsumed.length} entries → <b>${total}</b>.\n`
            + `Draft <b>${escHtml(json.data.invoiceNumber)}</b> ready for <b>${escHtml(json.data.clientName)}</b> — net-30, due <b>${shortDate(json.data.dueDate)}</b>.\n\n`
            + `Send it?`;
          try {
            await ctx.editMessageText(reply, {
              parse_mode: 'HTML',
              reply_markup: draftKeyboard(json.data.invoiceId),
            });
          } catch {
            await ctx.reply(reply, {
              parse_mode: 'HTML',
              reply_markup: draftKeyboard(json.data.invoiceId),
            });
          }
        } catch (err) {
          console.warn('[tmr_pickinvoice] failed:', err);
          await ctx.answerCallbackQuery({ text: 'Network error' });
        }
        return;
      }

      if (action === 'tmr_pickinvoicecancel') {
        const token = parts[1];
        if (token) {
          await db.abUserMemory.deleteMany({
            where: { tenantId, key: `telegram:pending_invoice_from_timer:${token}` },
          });
        }
        await ctx.answerCallbackQuery({ text: 'Cancelled' });
        try {
          await ctx.editMessageText('Cancelled. Nothing booked.');
        } catch {
          await ctx.reply('Cancelled. Nothing booked.');
        }
        return;
      }

      // mlg_edit:<entryId> — start a mileage-edit follow-up. The next
      // text message from this chat ID is captured by the
      // `telegram:editing_mileage:<chatId>` memory key (PR 4).
      if (action === 'mlg_edit') {
        const entryId = parts[1];
        if (!entryId) {
          await ctx.answerCallbackQuery({ text: 'No entry on file' });
          return;
        }
        const exists = await db.abMileageEntry.findFirst({
          where: { id: entryId, tenantId },
          select: { id: true },
        });
        if (!exists) {
          await ctx.answerCallbackQuery({ text: 'Entry not found' });
          return;
        }
        const memoryKey = `telegram:editing_mileage:${ctx.chat?.id ?? ''}`;
        const memoryValue = JSON.stringify({ entryId, setAt: Date.now() });
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
        await ctx.answerCallbackQuery({ text: '✏️ Send the new distance' });
        await ctx.reply('How many miles? (e.g. <code>47</code>)', { parse_mode: 'HTML' });
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

  // E2E_CAPTURE is a server-side test toggle; production has it off.
  // When on, we accept synthetic Updates without the Telegram secret so
  // the e2e suite (and PR-level webhook tests) can hit the route directly.
  if (expectedSecret && secret !== expectedSecret && !E2E_CAPTURE) {
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
