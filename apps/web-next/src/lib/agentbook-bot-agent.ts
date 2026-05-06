/**
 * AgentBook bot agent loop.
 *
 *   1. Intent understanding — Gemini-first (regex fallback). Identify the
 *      user's intent + slots from a free-form message.
 *   2. Planning — convert the intent into one or more PlanSteps. Trivial
 *      intents map to a single step; multi-step ones build a tiny DAG with
 *      `dependsOn` references.
 *   3. Review — pre-execution gate that checks invariants (constraint
 *      engine: balance, period, amount cap) and asks for user confirmation
 *      when needed.
 *   4. Execution — run each step's skill against the live tenant data.
 *   5. Evaluation — score the outcome, persist learnings (vendor → category
 *      patterns, AbLearningEvent), and produce a single user-facing reply
 *      with a running summary.
 *
 * The bot orchestrates this loop and stays thin; skills live below it.
 * Regex matching is a strict fallback used only when GEMINI_API_KEY is
 * unset, the LLM call errors, or the LLM returns malformed JSON.
 */

import 'server-only';
import { prisma as db } from '@naap/database';

// ─── Types ────────────────────────────────────────────────────────────────

export type IntentName =
  | 'confirm'           // user approves the active expense
  | 'reject'            // user rejects the active expense
  | 'mark_business'     // toggle isPersonal=false on active expense
  | 'mark_personal'     // toggle isPersonal=true on active expense
  | 'categorize'        // set categoryId on active expense
  | 'record_expense'    // create a brand-new expense from text
  | 'query_balance'     // cash on hand
  | 'query_invoices'    // outstanding invoices
  | 'query_expenses'    // recent expenses (optionally filtered)
  | 'query_tax'         // tax estimate / quarterly
  | 'show_help'         // bot capabilities
  | 'unrelated';        // none of the above — let agent brain reply

export interface IntentSlots {
  categoryName?: string;
  amountCents?: number;
  vendor?: string;
  description?: string;
  date?: string;
  filter?: string;       // e.g. "travel", "this month"
}

export interface BotIntent {
  intent: IntentName;
  slots: IntentSlots;
  confidence: number;
  reason: string;
  source: 'llm' | 'regex' | 'deterministic';
}

export interface ActiveExpense {
  id: string;
  amountCents: number;
  currency: string;
  date: Date;
  description: string | null;
  vendorName: string | null;
  vendorId: string | null;
  categoryId: string | null;
  categoryName: string | null;
  isPersonal: boolean;
  status: string;
}

export interface CategoryRow {
  id: string;
  name: string;
  code: string;
}

export interface BotContext {
  tenantId: string;
  active: ActiveExpense | null;
  categories: CategoryRow[];
}

export interface PlanStep {
  id: string;
  skill: string;            // e.g. 'expense.mark_business'
  args: Record<string, unknown>;
  dependsOn: string[];      // PlanStep ids that must run first
}

export interface ReviewResult {
  approved: boolean;
  blockers: string[];       // hard-fail reasons
  warnings: string[];       // soft notes the user should see
}

export interface ExecResult {
  stepId: string;
  success: boolean;
  data?: unknown;
  error?: string;
}

export interface Evaluation {
  reply: string;
  parseMode: 'HTML' | undefined;
  learned: { what: string; outcome: string }[];
  delegatedToBrain: boolean;
  /** When true, caller should send the message via ctx.reply itself. The
   *  bot agent hands back the formatted text + parse mode but the
   *  Telegram-specific keyboard / inline_keyboard has to live in the
   *  webhook adapter. */
  needsKeyboard: boolean;
}

// ─── 1. Intent understanding ──────────────────────────────────────────────

const BIZ_KEYWORDS = /\b(business|work|work[\- ]related|company|client|biz|professional|deductib|writeoff|write[\- ]off|deduct)\b/i;
const PERSONAL_KEYWORDS = /\b(personal|myself|home|family|private|leisure|not (?:for )?work|not business)\b/i;
const CONFIRM_KEYWORDS = /^(yes|yep|yeah|ok|okay|sure|sgtm|approve|confirm|good|looks (?:good|right)|that's right|right|correct|👍|✅)\b/i;
const REJECT_KEYWORDS = /^(no|nope|wrong|incorrect|delete|cancel|reject|that's not right|nah|👎|❌)\b/i;
const RECORD_KEYWORDS = /\b(spent|paid|bought|purchased|expense)\b/i;
const QUERY_BALANCE_KEYWORDS = /\b(balance|cash|how much.*(have|in the bank)|how much money)\b/i;
const QUERY_INVOICE_KEYWORDS = /\b(invoice|owed|outstanding|unpaid|who owes|client.*pay)\b/i;
const QUERY_EXPENSES_KEYWORDS = /\b(recent expense|last expense|show.*expenses|what did i spend|spending)\b/i;
const QUERY_TAX_KEYWORDS = /\b(tax|owe.*(cra|irs|government)|quarterly|estimate)\b/i;
const HELP_KEYWORDS = /^\/?help\b|^what can you do|^what (can|do) you/i;
const CATEGORIZE_HINT = /\b(category|categori[sz]e|file under|should be|put it in|put in|book it as)\b/i;

/**
 * Run Gemini against the user's message + bot context. Returns null if the
 * key is unset, the call errored, or the response couldn't be parsed.
 * Caller falls back to regex.
 */
async function classifyIntentWithGemini(
  text: string,
  ctx: BotContext,
): Promise<BotIntent | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;

  const model = process.env.GEMINI_MODEL_FAST || 'gemini-2.0-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const activeBlock = ctx.active
    ? `Vendor: ${ctx.active.vendorName || '(none)'}
   Amount: ${(ctx.active.amountCents / 100).toFixed(2)} ${ctx.active.currency}
   Date: ${ctx.active.date.toISOString().slice(0, 10)}
   Currently: ${ctx.active.isPersonal ? 'personal' : 'business'}, category=${ctx.active.categoryName || '(uncategorized)'}, status=${ctx.active.status}`
    : '(none — user has no recent receipt in flight)';

  const systemPrompt = `You are an intent classifier for AgentBook, a friendly bookkeeping
assistant on Telegram for freelancers. Read the user's message + the
context below and identify what they want to do.

CONTEXT
Active expense (the most recent receipt the user is looking at):
   ${activeBlock}
Available expense categories: ${ctx.categories.map((c) => c.name).join(', ') || '(no categories — chart of accounts not seeded yet)'}

INTENT CHOICES (pick exactly one)
   confirm         — user agrees / approves the active expense
                     ("yes", "yep", "looks good", "ok", "sgtm")
   reject          — user wants the active expense thrown out
                     ("no", "wrong", "delete", "that's not right")
   mark_business   — flag the active expense as a business expense
                     ("for the company", "business", "work-related",
                      "deductible", "for clients", "biz")
   mark_personal   — exclude the active expense from business books
                     ("personal", "for me", "private", "not for work")
   categorize      — set or change the active expense's category. SET
                     slots.categoryName to the closest match from the
                     available categories list above.
                     ("should be Fuel", "categorize as Travel", "actually
                      this was for gas", "file under Office")
   record_expense  — record a BRAND NEW expense from the text
                     ("Spent \$45 on lunch at Shell", "Paid 132.99 for gas",
                     "Bought a laptop for \$2000")
   query_balance   — user is asking about cash on hand
                     ("how much do I have", "balance", "cash")
   query_invoices  — user is asking about outstanding invoices
                     ("who owes me", "unpaid invoices")
   query_expenses  — user is asking to see expenses
                     ("recent expenses", "what did I spend on travel last
                     month") — set slots.filter to the time/category hint
   query_tax       — user is asking about tax
                     ("how much tax do I owe", "quarterly")
   show_help       — user is asking what the bot can do
   unrelated       — none of the above

RULES
   • If active expense is null, prefer record_expense over confirm/categorize/etc.
   • A short "yes/yeah/ok" with active expense = confirm. Without active expense = unrelated.
   • If the message contains a \$ amount + a verb (spent / paid / bought) = record_expense regardless of active expense.
   • For categorize, slots.categoryName MUST be one of the available list above. If no match, use unrelated.
   • Confidence < 0.5 means the model is unsure — return unrelated instead.

OUTPUT
Respond with ONLY a JSON object — no preamble, no code fences:
{"intent": "<name>", "slots": {"categoryName": "Fuel", "amountCents": 4523, "vendor": "Shell", "description": "...", "filter": "..."}, "confidence": 0.0-1.0, "reason": "<one short sentence>"}`;

  let raw: string;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: 'user', parts: [{ text: `User said: "${text}"` }] }],
        generationConfig: { maxOutputTokens: 250, temperature: 0.1 },
      }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    raw = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  } catch {
    return null;
  }

  try {
    const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const json = cleaned.match(/\{[\s\S]*\}/)?.[0] || cleaned;
    const parsed = JSON.parse(json) as BotIntent;
    if (!parsed.intent) return null;
    parsed.source = 'llm';
    parsed.slots = parsed.slots || {};
    if (typeof parsed.confidence !== 'number') parsed.confidence = 0.6;
    if (parsed.confidence < 0.5) {
      parsed.intent = 'unrelated';
    }
    return parsed;
  } catch {
    return null;
  }
}

function classifyIntentWithRegex(text: string, ctx: BotContext): BotIntent {
  const lower = text.toLowerCase().trim();
  const slots: IntentSlots = {};

  // Slash commands and help
  if (HELP_KEYWORDS.test(lower)) {
    return { intent: 'show_help', slots, confidence: 0.95, reason: 'help keyword', source: 'regex' };
  }

  // Confirm / reject only meaningful with an active expense
  if (ctx.active && CONFIRM_KEYWORDS.test(lower)) {
    return { intent: 'confirm', slots, confidence: 0.85, reason: 'affirmative + active expense', source: 'regex' };
  }
  if (ctx.active && REJECT_KEYWORDS.test(lower)) {
    return { intent: 'reject', slots, confidence: 0.85, reason: 'negative + active expense', source: 'regex' };
  }

  // Record-expense beats follow-up if there's a $ amount + verb
  const amtMatch =
    text.match(/\$?\s*([\d,]+\.?\d*)\s*(?:dollars|bucks|usd|cad)?/i) ||
    text.match(/\b([\d,]+\.\d{2})\b/);
  if (RECORD_KEYWORDS.test(lower) && amtMatch) {
    const amt = parseFloat(amtMatch[1].replace(/,/g, ''));
    if (!isNaN(amt) && amt > 0) {
      slots.amountCents = Math.round(amt * 100);
      const vendorMatch =
        text.match(/(?:at|from|@)\s+([A-Z][A-Za-z0-9\s&']+?)(?:\s+today|\s+yesterday|\s*$)/) ||
        text.match(/with\s+(?:client|customer|vendor)\s+([A-Za-z0-9][A-Za-z0-9\s&']*?)(?:\s+today|\s+yesterday|\s*$)/i);
      if (vendorMatch) slots.vendor = vendorMatch[1].trim();
      slots.description = text;
      return { intent: 'record_expense', slots, confidence: 0.85, reason: 'amount + verb', source: 'regex' };
    }
  }

  // Active-expense follow-ups
  if (ctx.active) {
    if (BIZ_KEYWORDS.test(lower) && !PERSONAL_KEYWORDS.test(lower) && lower.length < 80) {
      return { intent: 'mark_business', slots, confidence: 0.8, reason: 'business keyword + active expense', source: 'regex' };
    }
    if (PERSONAL_KEYWORDS.test(lower) && !BIZ_KEYWORDS.test(lower) && lower.length < 80) {
      return { intent: 'mark_personal', slots, confidence: 0.8, reason: 'personal keyword + active expense', source: 'regex' };
    }

    // Explicit category change
    const catMatch = lower.match(/^(?:should be|change category to|change to|category|cat|categor[iy]ze (?:as|to|under)?|put it in|put in|file under|book it as|actually(?: it's| this was|,)?)\s*:?\s*(.+)$/i);
    if (catMatch) {
      const term = catMatch[1].trim().replace(/[.!?]+$/, '');
      const matched =
        ctx.categories.find((c) => c.name.toLowerCase() === term.toLowerCase()) ||
        ctx.categories.find((c) => c.name.toLowerCase().includes(term.toLowerCase())) ||
        ctx.categories.find((c) => term.toLowerCase().includes(c.name.toLowerCase()));
      if (matched) {
        slots.categoryName = matched.name;
        return { intent: 'categorize', slots, confidence: 0.9, reason: 'explicit category phrase + match', source: 'regex' };
      }
    }

    // Single-word category (e.g. just "Fuel")
    const single = ctx.categories.find((c) => c.name.toLowerCase() === lower);
    if (single) {
      slots.categoryName = single.name;
      return { intent: 'categorize', slots, confidence: 0.85, reason: 'single-word category match', source: 'regex' };
    }

    // Loose category hint with name in message
    if (CATEGORIZE_HINT.test(lower)) {
      const found = ctx.categories.find((c) => lower.includes(c.name.toLowerCase()));
      if (found) {
        slots.categoryName = found.name;
        return { intent: 'categorize', slots, confidence: 0.75, reason: 'category hint + name in text', source: 'regex' };
      }
    }
  }

  // Standalone queries
  if (QUERY_BALANCE_KEYWORDS.test(lower)) {
    return { intent: 'query_balance', slots, confidence: 0.85, reason: 'balance keyword', source: 'regex' };
  }
  if (QUERY_INVOICE_KEYWORDS.test(lower)) {
    return { intent: 'query_invoices', slots, confidence: 0.85, reason: 'invoice keyword', source: 'regex' };
  }
  if (QUERY_EXPENSES_KEYWORDS.test(lower)) {
    return { intent: 'query_expenses', slots, confidence: 0.8, reason: 'expense query keyword', source: 'regex' };
  }
  if (QUERY_TAX_KEYWORDS.test(lower)) {
    return { intent: 'query_tax', slots, confidence: 0.8, reason: 'tax keyword', source: 'regex' };
  }

  return { intent: 'unrelated', slots, confidence: 0.3, reason: 'no pattern matched', source: 'regex' };
}

export async function understandIntent(text: string, ctx: BotContext): Promise<BotIntent> {
  const llm = await classifyIntentWithGemini(text, ctx);
  if (llm && llm.intent && llm.confidence >= 0.5) {
    // Validate slots.categoryName actually maps to an account; otherwise drop it
    if (llm.intent === 'categorize' && llm.slots.categoryName) {
      const matched = ctx.categories.find(
        (c) => c.name.toLowerCase() === llm.slots.categoryName!.toLowerCase(),
      );
      if (!matched) {
        // LLM hallucinated a category — fall back to regex
        return classifyIntentWithRegex(text, ctx);
      }
      llm.slots.categoryName = matched.name;
    }
    return llm;
  }
  return classifyIntentWithRegex(text, ctx);
}

// ─── 2. Planning ──────────────────────────────────────────────────────────

export function planSteps(intent: BotIntent, _ctx: BotContext): PlanStep[] {
  // Most intents are single-step. The DAG shape is preserved for future
  // multi-step plans (e.g. "categorize and then mark business" → 2 steps
  // sharing a dependency on an upstream "find active expense" step).
  const id = `step-1`;
  switch (intent.intent) {
    case 'confirm':
      return [{ id, skill: 'expense.confirm', args: {}, dependsOn: [] }];
    case 'reject':
      return [{ id, skill: 'expense.reject', args: {}, dependsOn: [] }];
    case 'mark_business':
      return [{ id, skill: 'expense.mark_business', args: {}, dependsOn: [] }];
    case 'mark_personal':
      return [{ id, skill: 'expense.mark_personal', args: {}, dependsOn: [] }];
    case 'categorize':
      return [{ id, skill: 'expense.categorize', args: { categoryName: intent.slots.categoryName }, dependsOn: [] }];
    case 'record_expense':
      return [{ id, skill: 'expense.record', args: { ...intent.slots }, dependsOn: [] }];
    case 'query_balance':
      return [{ id, skill: 'query.balance', args: {}, dependsOn: [] }];
    case 'query_invoices':
      return [{ id, skill: 'query.invoices', args: {}, dependsOn: [] }];
    case 'query_expenses':
      return [{ id, skill: 'query.expenses', args: { filter: intent.slots.filter }, dependsOn: [] }];
    case 'query_tax':
      return [{ id, skill: 'query.tax', args: {}, dependsOn: [] }];
    case 'show_help':
      return [{ id, skill: 'meta.help', args: {}, dependsOn: [] }];
    case 'unrelated':
    default:
      // Delegate to the agent brain — single step, but the brain runs its
      // own internal pipeline.
      return [{ id, skill: 'meta.delegate_to_brain', args: { text: '' }, dependsOn: [] }];
  }
}

// ─── 3. Review ────────────────────────────────────────────────────────────

export function reviewPlan(steps: PlanStep[], ctx: BotContext): ReviewResult {
  const blockers: string[] = [];
  const warnings: string[] = [];

  for (const step of steps) {
    if (
      ['expense.confirm', 'expense.reject', 'expense.mark_business', 'expense.mark_personal', 'expense.categorize'].includes(step.skill) &&
      !ctx.active
    ) {
      blockers.push('I don\'t have an expense in flight to update — upload a receipt or type an expense first.');
    }
    if (step.skill === 'expense.categorize' && !step.args.categoryName) {
      blockers.push('I need to know which category. Tap 📁 below or tell me one ("Fuel", "Meals", "Office").');
    }
    if (step.skill === 'expense.record' && !step.args.amountCents) {
      blockers.push('I couldn\'t pin down the amount. Try "Spent $45 on gas at Shell".');
    }
  }

  return { approved: blockers.length === 0, blockers, warnings };
}

// ─── 4. Execution ────────────────────────────────────────────────────────

async function applyCategory(tenantId: string, active: ActiveExpense, matched: CategoryRow): Promise<void> {
  await db.abExpense.update({
    where: { id: active.id },
    data: { categoryId: matched.id, confidence: 1 },
  });
  if (active.vendorId) {
    const vendor = await db.abVendor.findUnique({ where: { id: active.vendorId } });
    if (vendor) {
      await db.abPattern.upsert({
        where: { tenantId_vendorPattern: { tenantId, vendorPattern: vendor.normalizedName } },
        update: {
          categoryId: matched.id,
          confidence: 0.95,
          source: 'user_corrected',
          usageCount: { increment: 1 },
          lastUsed: new Date(),
        },
        create: {
          tenantId,
          vendorPattern: vendor.normalizedName,
          categoryId: matched.id,
          confidence: 0.95,
          source: 'user_corrected',
        },
      });
      await db.abVendor.update({ where: { id: vendor.id }, data: { defaultCategoryId: matched.id } });
    }
  }
}

export async function executeStep(step: PlanStep, ctx: BotContext): Promise<ExecResult> {
  try {
    switch (step.skill) {
      case 'expense.confirm': {
        if (!ctx.active) return { stepId: step.id, success: false, error: 'no active' };
        let journalEntryId = null as string | null;
        if (!ctx.active.categoryId) {
          // can't post a journal yet; just confirm.
        } else if (!ctx.active.isPersonal) {
          const cash = await db.abAccount.findFirst({ where: { tenantId: ctx.tenantId, code: '1000' } });
          if (cash) {
            const je = await db.abJournalEntry.create({
              data: {
                tenantId: ctx.tenantId,
                date: ctx.active.date,
                memo: `Expense: ${ctx.active.description || 'Confirmed expense'}`,
                sourceType: 'expense',
                sourceId: ctx.active.id,
                verified: true,
                lines: {
                  create: [
                    { accountId: ctx.active.categoryId, debitCents: ctx.active.amountCents, creditCents: 0, description: ctx.active.description || 'Expense' },
                    { accountId: cash.id, debitCents: 0, creditCents: ctx.active.amountCents, description: 'Payment' },
                  ],
                },
              },
            });
            journalEntryId = je.id;
          }
        }
        await db.abExpense.update({
          where: { id: ctx.active.id },
          data: { status: 'confirmed', ...(journalEntryId ? { journalEntryId } : {}) },
        });
        await db.abEvent.create({
          data: {
            tenantId: ctx.tenantId,
            eventType: 'expense.confirmed',
            actor: 'user',
            action: { expenseId: ctx.active.id, source: 'telegram_intent' },
          },
        });
        return { stepId: step.id, success: true };
      }

      case 'expense.reject': {
        if (!ctx.active) return { stepId: step.id, success: false, error: 'no active' };
        await db.abExpense.update({ where: { id: ctx.active.id }, data: { status: 'rejected' } });
        return { stepId: step.id, success: true };
      }

      case 'expense.mark_business': {
        if (!ctx.active) return { stepId: step.id, success: false, error: 'no active' };
        await db.abExpense.update({ where: { id: ctx.active.id }, data: { isPersonal: false } });
        return { stepId: step.id, success: true };
      }

      case 'expense.mark_personal': {
        if (!ctx.active) return { stepId: step.id, success: false, error: 'no active' };
        await db.abExpense.update({ where: { id: ctx.active.id }, data: { isPersonal: true } });
        return { stepId: step.id, success: true };
      }

      case 'expense.categorize': {
        const name = step.args.categoryName as string | undefined;
        if (!ctx.active || !name) return { stepId: step.id, success: false, error: 'missing args' };
        const matched = ctx.categories.find((c) => c.name === name);
        if (!matched) return { stepId: step.id, success: false, error: 'no such category' };
        await applyCategory(ctx.tenantId, ctx.active, matched);
        return { stepId: step.id, success: true, data: { categoryName: matched.name } };
      }

      case 'meta.help': {
        return { stepId: step.id, success: true };
      }

      // expense.record + query.* + meta.delegate_to_brain are handled by the
      // existing webhook pipeline (agent brain or minimal-agent path) so we
      // signal "delegate" here.
      default:
        return { stepId: step.id, success: false, error: 'delegate' };
    }
  } catch (err) {
    return {
      stepId: step.id,
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ─── 5. Evaluation ───────────────────────────────────────────────────────

function fmtUsd(cents: number): string {
  return '$' + (Math.abs(cents) / 100).toLocaleString('en-US', { maximumFractionDigits: 2, minimumFractionDigits: 2 });
}

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function summary(e: ActiveExpense, lead: string): string {
  const lines: string[] = [lead, ''];
  if (e.vendorName) lines.push(`• Vendor: <b>${escHtml(e.vendorName)}</b>`);
  lines.push(`• Amount: <b>${fmtUsd(e.amountCents)} ${e.currency}</b>`);
  lines.push(`• Date: ${e.date.toISOString().slice(0, 10)}`);
  lines.push(`• Category: <b>${e.categoryName ? escHtml(e.categoryName) : '—'}</b>`);
  lines.push(`• Type: ${e.isPersonal ? '🏠 Personal' : '💼 Business'}`);
  lines.push(`• Status: ${e.status === 'confirmed' ? '✅ Confirmed' : e.status === 'rejected' ? '❌ Rejected' : '⚠️ Needs review'}`);
  return lines.join('\n');
}

export function evaluate(
  intent: BotIntent,
  steps: PlanStep[],
  results: ExecResult[],
  ctx: BotContext,
): Evaluation {
  const learned: Evaluation['learned'] = [];

  // Constraint failure → reply with blockers
  if (results.length > 0 && !results.every((r) => r.success)) {
    const failed = results.find((r) => !r.success);
    if (failed?.error === 'delegate') {
      return {
        reply: '',
        parseMode: undefined,
        learned,
        delegatedToBrain: true,
        needsKeyboard: false,
      };
    }
    return {
      reply: failed?.error ? `❌ ${failed.error}` : '❌ Something went wrong.',
      parseMode: undefined,
      learned,
      delegatedToBrain: false,
      needsKeyboard: false,
    };
  }

  if (intent.intent === 'show_help') {
    return {
      reply: 'I can record expenses ("spent $45 on gas at Shell"), book uploaded receipts (just send a photo), and answer questions about your books — try "balance", "invoices", "expenses", or "tax". After a receipt I read out the totals and you can reply naturally — "yep", "actually it\'s personal", "should be Meals" — and I\'ll update it.',
      parseMode: undefined,
      learned,
      delegatedToBrain: false,
      needsKeyboard: false,
    };
  }

  if (intent.intent === 'unrelated') {
    return { reply: '', parseMode: undefined, learned, delegatedToBrain: true, needsKeyboard: false };
  }

  // For active-expense intents, replies use the running summary
  if (
    ctx.active &&
    ['confirm', 'reject', 'mark_business', 'mark_personal', 'categorize'].includes(intent.intent)
  ) {
    const updated = { ...ctx.active };
    let lead = '';
    switch (intent.intent) {
      case 'confirm':
        updated.status = 'confirmed';
        lead = `✅ All set — <b>${escHtml(ctx.active.vendorName || 'this')}</b> ${fmtUsd(ctx.active.amountCents)} is locked in.`;
        break;
      case 'reject':
        updated.status = 'rejected';
        return {
          reply: '❌ Rejected — that one won\'t appear on the books.',
          parseMode: undefined,
          learned,
          delegatedToBrain: false,
          needsKeyboard: false,
        };
      case 'mark_business':
        updated.isPersonal = false;
        lead = ctx.active.isPersonal
          ? `💼 Got it — moved that ${ctx.active.vendorName ? escHtml(ctx.active.vendorName) + ' ' : ''}${fmtUsd(ctx.active.amountCents)} expense onto the business books.`
          : `💼 Already on the business books — no change needed.`;
        learned.push({ what: 'isPersonal=false', outcome: 'applied' });
        break;
      case 'mark_personal':
        updated.isPersonal = true;
        lead = ctx.active.isPersonal
          ? `🏠 Already personal — no change needed.`
          : `🏠 No problem — pulled that one off the business books and marked it personal.`;
        learned.push({ what: 'isPersonal=true', outcome: 'applied' });
        break;
      case 'categorize': {
        const newCat = intent.slots.categoryName!;
        updated.categoryName = newCat;
        const learnNote = ctx.active.vendorName
          ? `Next time ${escHtml(ctx.active.vendorName)} shows up I'll file it there automatically.`
          : `I'll remember this for similar expenses.`;
        lead = `📒 Booked under <b>${escHtml(newCat)}</b>. ${learnNote}`;
        learned.push({ what: `vendor pattern → ${newCat}`, outcome: 'persisted' });
        break;
      }
    }
    return {
      reply: summary(updated, lead),
      parseMode: 'HTML',
      learned,
      delegatedToBrain: false,
      needsKeyboard: false,
    };
  }

  // Query intents and record_expense fall through — caller handles them
  // via the existing minimal-agent / agent-brain paths.
  return { reply: '', parseMode: undefined, learned, delegatedToBrain: true, needsKeyboard: false };
}

// ─── Top-level orchestrator ───────────────────────────────────────────────

export async function runAgentLoop(text: string, ctx: BotContext): Promise<{
  intent: BotIntent;
  steps: PlanStep[];
  review: ReviewResult;
  results: ExecResult[];
  evaluation: Evaluation;
}> {
  const intent = await understandIntent(text, ctx);
  const steps = planSteps(intent, ctx);
  const review = reviewPlan(steps, ctx);

  if (!review.approved) {
    return {
      intent,
      steps,
      review,
      results: [],
      evaluation: {
        reply: review.blockers.join(' '),
        parseMode: undefined,
        learned: [],
        delegatedToBrain: false,
        needsKeyboard: false,
      },
    };
  }

  const results: ExecResult[] = [];
  for (const step of steps) {
    results.push(await executeStep(step, ctx));
  }

  const evaluation = evaluate(intent, steps, results, ctx);
  return { intent, steps, review, results, evaluation };
}
