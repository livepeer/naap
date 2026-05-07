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
import { parseInvoiceFromText } from './agentbook-invoice-parser';
import { createInvoiceDraft } from './agentbook-invoice-draft';
import { parseDateHint, aggregateByDay, type TimeEntryRow } from './agentbook-time-aggregator';
import { resolveClientByHint } from './agentbook-client-resolver';
import { getMileageRate } from './agentbook-mileage-rates';
import { resolveVehicleAccounts } from './agentbook-account-resolver';

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
  | 'undo_last'         // reverse / delete the most recent expense
  | 'update_amount'     // fix the amount on the active expense
  | 'create_invoice_from_chat' // user is asking the bot to draft an invoice
  | 'start_timer'       // /timer start — begin tracking time for a client / task
  | 'stop_timer'        // /timer stop — close out the running entry
  | 'timer_status'      // /timer status — what's running + today's total
  | 'invoice_from_timer' // build an invoice from accumulated unbilled hours
  | 'record_mileage'    // "drove 47 miles to TechCorp" → mileage entry + JE (PR 4)
  | 'clarify'           // bot is unsure — ask the user a question first
  | 'unrelated';        // none of the above — let agent brain reply

export interface IntentSlots {
  categoryName?: string;
  amountCents?: number;
  vendor?: string;
  description?: string;
  date?: string;
  filter?: string;        // e.g. "travel", "this month"
  clarifyingQuestion?: string;  // bot's question back to the user
  candidateIntents?: IntentName[]; // intents the bot is choosing between
  // Timer-flow slots (PR 2):
  clientNameHint?: string;     // raw client text: "TechCorp", "Acme"
  taskDescription?: string;    // what the user is working on
  dateHint?: string;           // "this week" / "last week" / "this month" / "last month"
  // Mileage-flow slots (PR 4):
  miles?: number;              // distance value the user spoke (mi or km)
  unit?: 'mi' | 'km';          // which unit the value refers to
  purpose?: string;            // free-form trip purpose ("TechCorp meeting")
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
   create_invoice_from_chat — user wants to create / send an invoice to
                     a client. Triggers: "invoice <client> \$<amount>
                     for <desc>", "send <client> a \$<amt> invoice",
                     "bill <client> \$<amt> for <desc>". SET
                     slots.description to the FULL raw user text — the
                     downstream parser handles client name, line items,
                     amount, and due date.
                     IMPORTANT: do NOT pick this when the user mentions
                     "timer" or "tracked time" — that's invoice_from_timer.
                     ("invoice Acme \$5K for July consulting",
                      "bill TechCorp \$3000 for design and \$500 hosting",
                      "send Maya a \$1200 invoice for retainer")
   start_timer     — start a new running time entry. Triggers: "/timer
                     start <client> <task>", "start a timer for X",
                     "track time on Y". SET slots.clientNameHint to the
                     client (raw text; the bot resolves it) and
                     slots.taskDescription to whatever follows.
                     ("/timer start TechCorp planning",
                      "start a timer for Acme — design review")
   stop_timer      — stop the currently running timer. Triggers: "/timer
                     stop", "stop the timer", "I'm done".
   timer_status    — what timer is running + how much logged today.
                     Triggers: "/timer status", "/timer", "is my timer
                     running?".
   invoice_from_timer — build an invoice from accumulated unbilled hours
                     for a client. Triggers contain BOTH a client and the
                     phrase "from timer" / "from my hours" /
                     "from tracked time". SET slots.clientNameHint to
                     the client and slots.dateHint to the time-window
                     phrase if present ("this week", "last week",
                     "this month", "last month"; default "this month").
                     ("invoice TechCorp from timer this week",
                      "bill Acme from my hours last month",
                      "create an invoice for TechCorp from tracked time")
   record_mileage  — user drove some distance for business and wants it
                     booked at the standard mileage rate.
                     Triggers contain a verb like "drove" / "drive" /
                     "driven" + a number + a unit (mi/miles/km/kilometres).
                     SET slots.miles to the numeric distance,
                     slots.unit to "mi" or "km" (default "mi" if absent),
                     slots.purpose to whatever follows the unit (the
                     client / destination / reason), and
                     slots.clientNameHint to a client name if mentioned.
                     If the message says "1.5 hours driving" or similar
                     time-based driving phrase WITHOUT a distance, choose
                     clarify and set clarifyingQuestion to "How many
                     miles?".
                     ("drove 47 miles to TechCorp",
                      "drove 23 km client meeting",
                      "47 mi from office to airport")
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
   undo_last       — user wants to reverse / scrap the most recent expense
                     ("undo", "scratch that", "scratch the last one",
                      "delete the last expense", "actually never mind",
                      "remove that", "go back")
                     For a draft (pending_review): delete it.
                     For a booked one (confirmed): post a reversing journal
                     and mark rejected.
   update_amount   — user is correcting the amount on the active expense.
                     SET slots.amountCents.
                     ("change it to \$45", "the amount is \$54.99",
                      "actually it was 132", "fix the total to \$200")
   clarify         — you genuinely cannot tell what the user means OR
                     they could plausibly mean two of the above. Don't
                     guess — ASK them. Set slots.clarifyingQuestion to a
                     short, natural follow-up question (one sentence,
                     friendly accountant tone, max ~120 chars). If two
                     intents are plausible, set slots.candidateIntents.
                     Examples that should clarify (not guess):
                       • "yeah" with no active expense → ask what they mean
                       • "Starbucks" alone → could be category Meals or
                         a new expense; ask
                       • "make it 50" with no active expense → ask
                       • "fine" → ambiguous; ask
                       • Receipt at coffee shop, user says "client meeting"
                         → it could be Meals (categorize) AND business
                         (mark_business). Pick one or clarify.
   unrelated       — message clearly isn't about the books at all

RULES
   • If active expense is null, prefer record_expense over confirm/categorize/etc.
   • A short "yes/yeah/ok" with active expense = confirm. Without active expense = clarify (ask them what to confirm).
   • If the message contains a \$ amount + a verb (spent / paid / bought) = record_expense regardless of active expense.
   • For categorize, slots.categoryName MUST be one of the available list above. If no exact-or-close match, use clarify with the candidate options in the question.
   • Confidence below 0.7 = clarify (better to ask than to guess wrong on the user's books).
   • A great accountant ASKS when uncertain. Don't be afraid to clarify.

OUTPUT
Respond with ONLY a JSON object — no preamble, no code fences:
{"intent": "<name>", "slots": {"categoryName": "Fuel", "amountCents": 4523, "vendor": "Shell", "description": "...", "filter": "...", "clarifyingQuestion": "...", "candidateIntents": ["...", "..."], "miles": 47, "unit": "mi", "purpose": "TechCorp meeting", "clientNameHint": "TechCorp"}, "confidence": 0.0-1.0, "reason": "<one short sentence>"}`;

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
    // Below 0.5: clearly off-topic, let the agent brain handle it.
    if (parsed.confidence < 0.5) {
      parsed.intent = 'unrelated';
    }
    // 0.5–0.7: model is on-topic but unsure — convert to clarify if it
    // didn't already, so the bot asks instead of guessing on the user's
    // books. Skip if the LLM already returned a question.
    if (
      parsed.intent !== 'clarify' &&
      parsed.intent !== 'unrelated' &&
      parsed.confidence < 0.7 &&
      !parsed.slots.clarifyingQuestion
    ) {
      parsed.slots.clarifyingQuestion = `I read that as "${parsed.intent.replace('_', ' ')}" but I'm not 100% sure — can you confirm or rephrase?`;
      parsed.intent = 'clarify';
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

  // Undo / scratch — needs an active expense to be useful.
  if (ctx.active && /^(undo|scratch (?:that|the last|it)|delete (?:that|the last|it)|never mind|remove (?:that|the last|it)|go back)\b/i.test(lower)) {
    return { intent: 'undo_last', slots, confidence: 0.9, reason: 'undo keyword + active expense', source: 'regex' };
  }

  // Amount correction — "change it to $45", "actually it was 132".
  if (ctx.active) {
    const amountFixMatch = lower.match(/(?:change|fix|correct|update|set)\s+(?:it|the (?:amount|total)|that)\s*(?:to|=|is)?\s*\$?([\d,]+(?:\.\d{1,2})?)/i)
      || lower.match(/(?:actually|it was|the amount is|total is)\s*\$?([\d,]+(?:\.\d{1,2})?)\s*$/i);
    if (amountFixMatch) {
      const amt = parseFloat(amountFixMatch[1].replace(/,/g, ''));
      if (!isNaN(amt) && amt > 0) {
        slots.amountCents = Math.round(amt * 100);
        return { intent: 'update_amount', slots, confidence: 0.85, reason: 'amount-fix phrase + active expense', source: 'regex' };
      }
    }
  }

  // Confirm / reject only meaningful with an active expense
  if (ctx.active && CONFIRM_KEYWORDS.test(lower)) {
    return { intent: 'confirm', slots, confidence: 0.85, reason: 'affirmative + active expense', source: 'regex' };
  }
  if (ctx.active && REJECT_KEYWORDS.test(lower)) {
    return { intent: 'reject', slots, confidence: 0.85, reason: 'negative + active expense', source: 'regex' };
  }

  // Timer flow (PR 2). Order matters: `invoice_from_timer` must be
  // checked BEFORE the generic invoice trigger below so "invoice X from
  // timer this week" doesn't get parsed as a regular invoice-from-chat.
  // Slash-commands (`/timer ...`) are exact triggers; the natural-
  // language form is intentionally narrow to avoid stealing turns from
  // the broader create_invoice_from_chat intent.
  const timerStartMatch = text.match(/^\/timer\s+start\b\s*(.*)$/i);
  if (timerStartMatch) {
    const tail = timerStartMatch[1].trim();
    // Heuristic: first capitalised word(s) → client; rest → task.
    // Falls back to the whole tail as the task if no client cap appears.
    const clientCapMatch = tail.match(/^([A-Z][\w&'\-.]*(?:\s+[A-Z][\w&'\-.]*)*)\s*(.*)$/);
    const startSlots: IntentSlots = {};
    if (clientCapMatch) {
      startSlots.clientNameHint = clientCapMatch[1].trim();
      const rest = clientCapMatch[2].trim();
      if (rest) startSlots.taskDescription = rest;
    } else if (tail) {
      startSlots.taskDescription = tail;
    }
    return {
      intent: 'start_timer',
      slots: startSlots,
      confidence: 0.95,
      reason: '/timer start slash command',
      source: 'regex',
    };
  }
  if (/^\/timer\s+stop\b/i.test(text)) {
    return { intent: 'stop_timer', slots, confidence: 0.95, reason: '/timer stop slash command', source: 'regex' };
  }
  if (/^\/timer\s+status\b/i.test(text) || /^\/timer\s*$/i.test(text)) {
    return { intent: 'timer_status', slots, confidence: 0.95, reason: '/timer status slash command', source: 'regex' };
  }
  // Natural-language invoice-from-timer. Extract client (text between
  // the verb and " from timer ") and date hint (anything after "timer").
  const fromTimerMatch = text.match(/^(?:please\s+|can you\s+)?(?:invoice|bill|create(?:\s+an?)?\s+invoice(?:\s+for)?|send(?:\s+\w+)?\s+invoice(?:\s+for)?)\s+(.+?)\s+from\s+(?:timer|my\s+hours|my\s+tracked\s+time|tracked\s+time)\b\s*(.*)$/i);
  if (fromTimerMatch) {
    const clientNameHint = fromTimerMatch[1].trim().replace(/\s+/g, ' ');
    const tail = fromTimerMatch[2].trim().toLowerCase();
    let dateHint: string | undefined;
    if (/last\s+week/.test(tail)) dateHint = 'last week';
    else if (/this\s+week/.test(tail)) dateHint = 'this week';
    else if (/last\s+month/.test(tail)) dateHint = 'last month';
    else if (/this\s+month/.test(tail)) dateHint = 'this month';
    return {
      intent: 'invoice_from_timer',
      slots: { clientNameHint, dateHint },
      confidence: 0.9,
      reason: 'invoice…from timer trigger phrase',
      source: 'regex',
    };
  }

  // Mileage (PR 4): "drove 47 miles to TechCorp", "drove 23 km client
  // meeting", "47 mi from office to airport". Must beat the generic
  // record_expense path because the number after "drove" looks like an
  // amount; we own this trigger phrase.
  const mileageMatch =
    text.match(/\b(?:drove|driven|drive)\s+(\d+(?:\.\d+)?)\s*(mi|miles|km|kilometers|kilometres)?\b\s*(?:to|for|on|at|—|-)?\s*(.*)$/i)
    || text.match(/^(\d+(?:\.\d+)?)\s*(mi|miles|km|kilometers|kilometres)\s+(?:to|for|on|from|at|—|-)\s+(.+)$/i);
  if (mileageMatch) {
    const miles = parseFloat(mileageMatch[1]);
    if (isFinite(miles) && miles > 0) {
      const rawUnitRaw = mileageMatch[2];
      const unitGiven = !!rawUnitRaw;
      const rawUnit = (rawUnitRaw || 'mi').toLowerCase();
      const unit: 'mi' | 'km' = /km|kilom/i.test(rawUnit) ? 'km' : 'mi';

      // Ambiguous-driving guard: when no unit was given AND the value
      // looks like hours (≤ 24) AND the text mentions "hour|hr", the
      // user almost certainly said "drove for 2 hours" — not 2 miles.
      // Re-route to clarify rather than booking 2 miles silently.
      if (!unitGiven && miles <= 24 && /\b(?:hour|hours|hr|hrs)\b/i.test(text)) {
        return {
          intent: 'clarify',
          slots: { clarifyingQuestion: 'How many miles?' },
          confidence: 0.85,
          reason: 'ambiguous "drove N hours" without distance unit',
          source: 'regex',
        };
      }

      // Purpose extraction post-processing: trim trailing punctuation,
      // strip leading prepositions ("to TechCorp" → "TechCorp"; "from
      // office" → "office"), and default to "Business travel" if the
      // user only said "drove 47 miles." with no destination.
      let purposeRaw = (mileageMatch[3] || '').trim().replace(/[.!?]+$/, '');
      purposeRaw = purposeRaw.replace(/^(?:to|for|on|at|from|—|-)\s+/i, '').trim();
      const purpose = purposeRaw || 'Business travel';

      // Lift a capitalised word/phrase as the client hint when present.
      let clientNameHint: string | undefined;
      const capMatch = purposeRaw.match(/\b([A-Z][\w&'\-.]*(?:\s+[A-Z][\w&'\-.]*)*)\b/);
      if (capMatch) clientNameHint = capMatch[1];
      return {
        intent: 'record_mileage',
        slots: {
          miles,
          unit,
          purpose,
          clientNameHint,
        },
        confidence: 0.9,
        reason: 'drove + number + unit',
        source: 'regex',
      };
    }
  }
  // Time-based driving (no distance): "log 1.5 hours driving for client work".
  if (/\b(?:hours?|hrs?)\s+(?:of\s+)?driv/i.test(text)) {
    return {
      intent: 'clarify',
      slots: { clarifyingQuestion: 'How many miles?' },
      confidence: 0.85,
      reason: 'time-based driving needs distance',
      source: 'regex',
    };
  }

  // Invoice creation — "invoice Acme $5K for July consulting", "bill X
  // $1000 for Y", "send Acme an invoice". Beats record_expense, since
  // "invoice" is more specific than the spent/paid/bought verbs.
  if (/^(?:please\s+|can you\s+)?(?:invoice|bill|send.+invoice|create.+invoice)\s+/i.test(text)) {
    return {
      intent: 'create_invoice_from_chat',
      slots: { description: text },
      confidence: 0.85,
      reason: 'invoice trigger phrase',
      source: 'regex',
    };
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
    case 'create_invoice_from_chat':
      return [{
        id,
        skill: 'invoice.create_from_chat',
        args: { text: intent.slots.description || '' },
        dependsOn: [],
      }];
    case 'start_timer':
      return [{
        id,
        skill: 'timer.start',
        args: {
          clientNameHint: intent.slots.clientNameHint,
          taskDescription: intent.slots.taskDescription,
        },
        dependsOn: [],
      }];
    case 'stop_timer':
      return [{ id, skill: 'timer.stop', args: {}, dependsOn: [] }];
    case 'timer_status':
      return [{ id, skill: 'timer.status', args: {}, dependsOn: [] }];
    case 'invoice_from_timer':
      return [{
        id,
        skill: 'invoice.from_timer',
        args: {
          clientNameHint: intent.slots.clientNameHint,
          dateHint: intent.slots.dateHint,
        },
        dependsOn: [],
      }];
    case 'record_mileage':
      return [{
        id,
        skill: 'mileage.record',
        args: {
          miles: intent.slots.miles,
          unit: intent.slots.unit,
          purpose: intent.slots.purpose,
          clientNameHint: intent.slots.clientNameHint,
        },
        dependsOn: [],
      }];
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
    case 'undo_last':
      return [{ id, skill: 'expense.undo_last', args: {}, dependsOn: [] }];
    case 'update_amount':
      return [{ id, skill: 'expense.update_amount', args: { amountCents: intent.slots.amountCents }, dependsOn: [] }];
    case 'clarify':
      return [{
        id,
        skill: 'meta.clarify',
        args: {
          question: intent.slots.clarifyingQuestion || 'Could you say that another way?',
          candidates: intent.slots.candidateIntents || [],
        },
        dependsOn: [],
      }];
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
    // Confirmation gate: don't book a business expense without a category.
    if (step.skill === 'expense.confirm' && ctx.active && !ctx.active.categoryId && !ctx.active.isPersonal) {
      blockers.push('I can\'t book this without a category. Tell me one ("Fuel", "Meals", "Office") or tap 📁 below.');
    }
    if ((step.skill === 'expense.undo_last' || step.skill === 'expense.update_amount') && !ctx.active) {
      blockers.push('I don\'t have a recent expense to update. Upload a receipt first.');
    }
    if (step.skill === 'expense.update_amount') {
      const amt = step.args.amountCents as number | undefined;
      if (!amt || amt <= 0) {
        blockers.push('I need a positive dollar amount. Try "fix it to $45".');
      }
    }
    if (step.skill === 'mileage.record') {
      const m = step.args.miles as number | undefined;
      if (!m || m <= 0) {
        blockers.push('I need a positive distance. Try "drove 47 miles to TechCorp".');
      }
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

      case 'expense.undo_last': {
        if (!ctx.active) return { stepId: step.id, success: false, error: 'no active' };
        if (ctx.active.status === 'rejected') {
          return {
            stepId: step.id,
            success: true,
            data: { wasAlready: true, vendorName: ctx.active.vendorName, amountCents: ctx.active.amountCents },
          };
        }

        // Confirmed + booked → post a reversing journal entry, mark
        // rejected. (Journal entries are immutable per the constraint
        // engine; corrections are reversing entries, never edits.)
        if (ctx.active.status === 'confirmed' && ctx.active.categoryId && !ctx.active.isPersonal) {
          const expenseRow = await db.abExpense.findUnique({
            where: { id: ctx.active.id },
            select: { journalEntryId: true },
          });
          if (expenseRow?.journalEntryId) {
            const original = await db.abJournalEntry.findUnique({
              where: { id: expenseRow.journalEntryId },
              include: { lines: true },
            });
            if (original) {
              await db.abJournalEntry.create({
                data: {
                  tenantId: ctx.tenantId,
                  date: new Date(),
                  memo: `REVERSAL: ${original.memo}`,
                  sourceType: 'expense',
                  sourceId: ctx.active.id,
                  verified: true,
                  lines: {
                    create: original.lines.map((l) => ({
                      accountId: l.accountId,
                      // swap debit and credit to reverse the original entry
                      debitCents: l.creditCents,
                      creditCents: l.debitCents,
                      description: `Reversal: ${l.description || ''}`,
                    })),
                  },
                },
              });
            }
          }
          await db.abExpense.update({
            where: { id: ctx.active.id },
            data: { status: 'rejected' },
          });
        } else {
          // Draft or personal — no journal to reverse, just delete the
          // expense outright since it never made it onto the books.
          await db.abExpense.delete({ where: { id: ctx.active.id } });
        }

        // Clear the active-expense memory so subsequent follow-ups can't
        // hit a deleted row.
        await db.abUserMemory.deleteMany({
          where: { tenantId: ctx.tenantId, key: 'telegram:active_expense' },
        });

        await db.abEvent.create({
          data: {
            tenantId: ctx.tenantId,
            eventType: 'expense.undone',
            actor: 'user',
            action: {
              expenseId: ctx.active.id,
              previousStatus: ctx.active.status,
              vendorName: ctx.active.vendorName,
              amountCents: ctx.active.amountCents,
            },
          },
        });
        return {
          stepId: step.id,
          success: true,
          data: {
            previousStatus: ctx.active.status,
            vendorName: ctx.active.vendorName,
            amountCents: ctx.active.amountCents,
          },
        };
      }

      case 'expense.update_amount': {
        if (!ctx.active) return { stepId: step.id, success: false, error: 'no active' };
        const newAmount = step.args.amountCents as number;
        const previousAmount = ctx.active.amountCents;
        if (newAmount === previousAmount) {
          return { stepId: step.id, success: true, data: { unchanged: true } };
        }

        // If the expense is already booked to the ledger, post a
        // reversing entry and a fresh entry at the new amount. The
        // immutability rule means we cannot just patch the journal lines.
        if (
          ctx.active.status === 'confirmed' &&
          ctx.active.categoryId &&
          !ctx.active.isPersonal
        ) {
          const expenseRow = await db.abExpense.findUnique({
            where: { id: ctx.active.id },
            select: { journalEntryId: true },
          });
          if (expenseRow?.journalEntryId) {
            const original = await db.abJournalEntry.findUnique({
              where: { id: expenseRow.journalEntryId },
              include: { lines: true },
            });
            if (original) {
              await db.abJournalEntry.create({
                data: {
                  tenantId: ctx.tenantId,
                  date: new Date(),
                  memo: `REVERSAL: ${original.memo} (amount fix)`,
                  sourceType: 'expense',
                  sourceId: ctx.active.id,
                  verified: true,
                  lines: {
                    create: original.lines.map((l) => ({
                      accountId: l.accountId,
                      debitCents: l.creditCents,
                      creditCents: l.debitCents,
                      description: `Reversal: ${l.description || ''}`,
                    })),
                  },
                },
              });
            }
            const cash = await db.abAccount.findFirst({
              where: { tenantId: ctx.tenantId, code: '1000' },
            });
            if (cash) {
              const replacement = await db.abJournalEntry.create({
                data: {
                  tenantId: ctx.tenantId,
                  date: ctx.active.date,
                  memo: `Expense (amended): ${ctx.active.description || 'Expense'}`,
                  sourceType: 'expense',
                  sourceId: ctx.active.id,
                  verified: true,
                  lines: {
                    create: [
                      { accountId: ctx.active.categoryId, debitCents: newAmount, creditCents: 0, description: ctx.active.description || 'Expense' },
                      { accountId: cash.id, debitCents: 0, creditCents: newAmount, description: 'Payment' },
                    ],
                  },
                },
              });
              await db.abExpense.update({
                where: { id: ctx.active.id },
                data: { amountCents: newAmount, journalEntryId: replacement.id },
              });
            } else {
              await db.abExpense.update({
                where: { id: ctx.active.id },
                data: { amountCents: newAmount },
              });
            }
          } else {
            await db.abExpense.update({
              where: { id: ctx.active.id },
              data: { amountCents: newAmount },
            });
          }
        } else {
          // Draft or personal — no journal entry to reverse, just patch.
          await db.abExpense.update({
            where: { id: ctx.active.id },
            data: { amountCents: newAmount },
          });
        }

        await db.abEvent.create({
          data: {
            tenantId: ctx.tenantId,
            eventType: 'expense.amount_updated',
            actor: 'user',
            action: {
              expenseId: ctx.active.id,
              previousAmount,
              newAmount,
            },
          },
        });
        return { stepId: step.id, success: true, data: { previousAmount, newAmount } };
      }

      case 'invoice.create_from_chat': {
        const text = (step.args.text as string | undefined) || '';
        if (!text.trim()) {
          return { stepId: step.id, success: false, error: 'No invoice text provided.' };
        }
        const parsed = await parseInvoiceFromText(text);
        if (!parsed) {
          return {
            stepId: step.id,
            success: true,
            data: {
              kind: 'needs_clarify',
              question: "I read that as an invoice but couldn't pin down the client and amount. Try \"invoice Acme $5K for July consulting\".",
            },
          };
        }

        // Resolve client via the shared exact-then-substring helper.
        const resolution = await resolveClientByHint(ctx.tenantId, parsed.clientNameHint);
        const candidates = resolution.candidates;

        if (candidates.length === 0) {
          return {
            stepId: step.id,
            success: true,
            data: {
              kind: 'needs_clarify',
              question: `Which client is "${parsed.clientNameHint}"? I don't have one with that name on file.`,
              parsed,
            },
          };
        }
        if (candidates.length > 1) {
          return {
            stepId: step.id,
            success: true,
            data: {
              kind: 'ambiguous',
              clientNameHint: parsed.clientNameHint,
              candidates: candidates.map((c) => ({ id: c.id, name: c.name, email: c.email })),
              parsed,
            },
          };
        }

        // Single match — create the draft directly. The shared helper
        // owns numbering, currency fallback, line creation, and the
        // AbEvent emission so this path stays byte-identical to the
        // HTTP draft-from-text route.
        const draft = await createInvoiceDraft({
          tenantId: ctx.tenantId,
          client: { id: candidates[0].id, name: candidates[0].name, email: candidates[0].email },
          parsed,
        });

        return {
          stepId: step.id,
          success: true,
          data: {
            kind: 'draft_created',
            ...draft,
          },
        };
      }

      // ─── Timer + invoice-from-timer (PR 2) ──────────────────────────
      case 'timer.start': {
        const clientNameHint = step.args.clientNameHint as string | undefined;
        const taskDescription = step.args.taskDescription as string | undefined;

        // Resolve client: 0 → no client (still start, log freeform), 1 → bind, 2+ → ask the
        // webhook to surface a picker before starting (so we never bind to
        // the wrong client at start time).
        let clientId: string | null = null;
        let clientName: string | null = null;
        if (clientNameHint && clientNameHint.trim()) {
          const resolution = await resolveClientByHint(ctx.tenantId, clientNameHint);
          const matches = resolution.candidates;
          if (matches.length === 1) {
            clientId = matches[0].id;
            clientName = matches[0].name;
          } else if (matches.length > 1) {
            // Hand back to the webhook adapter to surface the picker.
            return {
              stepId: step.id,
              success: true,
              data: {
                kind: 'needs_picker',
                clientNameHint,
                taskDescription: taskDescription || 'Working',
                candidates: matches.map((c) => ({ id: c.id, name: c.name })),
              },
            };
          } else {
            // No match — start the timer anyway under freeform description
            // so the user isn't blocked, and let them attach a client
            // later. The webhook can warn that the name didn't resolve.
            clientName = null;
          }
        }

        // Auto-stop any running timer (mirrors POST /timer/start behaviour).
        const running = await db.abTimeEntry.findFirst({
          where: { tenantId: ctx.tenantId, endedAt: null },
        });
        if (running) {
          const dur = Math.max(1, Math.round((Date.now() - running.startedAt.getTime()) / 60_000));
          await db.abTimeEntry.update({
            where: { id: running.id },
            data: { endedAt: new Date(), durationMinutes: dur },
          });
        }

        const entry = await db.abTimeEntry.create({
          data: {
            tenantId: ctx.tenantId,
            clientId: clientId || undefined,
            description: (taskDescription && taskDescription.trim()) || 'Working',
            startedAt: new Date(),
          },
        });

        return {
          stepId: step.id,
          success: true,
          data: {
            kind: 'started',
            entryId: entry.id,
            clientId,
            clientName,
            clientNameHint: clientNameHint || null,
            taskDescription: entry.description,
            unmatchedClientHint: clientNameHint && !clientId ? clientNameHint : null,
          },
        };
      }

      case 'timer.stop': {
        const running = await db.abTimeEntry.findFirst({
          where: { tenantId: ctx.tenantId, endedAt: null },
          orderBy: { startedAt: 'desc' },
        });
        if (!running) {
          return {
            stepId: step.id,
            success: true,
            data: { kind: 'not_running' },
          };
        }
        const dur = Math.max(1, Math.round((Date.now() - running.startedAt.getTime()) / 60_000));
        const updated = await db.abTimeEntry.update({
          where: { id: running.id },
          data: { endedAt: new Date(), durationMinutes: dur },
        });
        await db.abEvent.create({
          data: {
            tenantId: ctx.tenantId,
            eventType: 'time.logged',
            actor: 'agent',
            action: { entryId: updated.id, minutes: dur, source: 'telegram' },
          },
        });

        // Compute "this week" total for the friendly summary. Use the
        // tenant timezone via parseDateHint so the week boundary lines
        // up with the user's local Monday.
        const tenantConfig = await db.abTenantConfig.findUnique({
          where: { userId: ctx.tenantId },
          select: { timezone: true },
        });
        const tz = tenantConfig?.timezone || 'UTC';
        const week = parseDateHint('this week', tz);
        const weekEntries = await db.abTimeEntry.findMany({
          where: {
            tenantId: ctx.tenantId,
            startedAt: { gte: week.startDate, lt: week.endDate },
          },
          select: { durationMinutes: true },
        });
        const weekTotalMinutes = weekEntries.reduce((s, e) => s + (e.durationMinutes || 0), 0);

        let clientName: string | null = null;
        if (updated.clientId) {
          const c = await db.abClient.findUnique({
            where: { id: updated.clientId },
            select: { name: true },
          });
          clientName = c?.name || null;
        }

        return {
          stepId: step.id,
          success: true,
          data: {
            kind: 'stopped',
            entryId: updated.id,
            minutesLogged: dur,
            weekTotalMinutes,
            clientName,
            description: updated.description,
          },
        };
      }

      case 'timer.status': {
        const tenantConfig = await db.abTenantConfig.findUnique({
          where: { userId: ctx.tenantId },
          select: { timezone: true },
        });
        const tz = tenantConfig?.timezone || 'UTC';

        const running = await db.abTimeEntry.findFirst({
          where: { tenantId: ctx.tenantId, endedAt: null },
          orderBy: { startedAt: 'desc' },
        });

        // Today = [todayStart, tomorrowStart) in tenant TZ. parseDateHint
        // does the DST-aware day-walk for us — survives spring-forward
        // (23h day) and fall-back (25h day) without an off-by-one.
        const today = parseDateHint('today', tz);

        const todayEntries = await db.abTimeEntry.findMany({
          where: {
            tenantId: ctx.tenantId,
            startedAt: { gte: today.startDate, lt: today.endDate },
          },
          select: { durationMinutes: true, startedAt: true, endedAt: true },
        });
        let todayTotalMinutes = 0;
        for (const e of todayEntries) {
          if (e.endedAt) {
            todayTotalMinutes += e.durationMinutes || 0;
          } else {
            // Running entry — count elapsed minutes so the displayed
            // "today's total" matches what the user expects.
            todayTotalMinutes += Math.max(1, Math.round((Date.now() - e.startedAt.getTime()) / 60000));
          }
        }

        if (!running) {
          return {
            stepId: step.id,
            success: true,
            data: { kind: 'idle', todayTotalMinutes },
          };
        }

        const elapsedMinutes = Math.max(0, Math.round((Date.now() - running.startedAt.getTime()) / 60_000));
        let clientName: string | null = null;
        if (running.clientId) {
          const c = await db.abClient.findUnique({
            where: { id: running.clientId },
            select: { name: true },
          });
          clientName = c?.name || null;
        }
        return {
          stepId: step.id,
          success: true,
          data: {
            kind: 'running',
            entryId: running.id,
            elapsedMinutes,
            description: running.description,
            clientName,
            todayTotalMinutes,
          },
        };
      }

      case 'invoice.from_timer': {
        const clientNameHint = step.args.clientNameHint as string | undefined;
        const dateHint = step.args.dateHint as string | undefined;
        if (!clientNameHint || !clientNameHint.trim()) {
          return {
            stepId: step.id,
            success: true,
            data: {
              kind: 'needs_clarify',
              question: 'Which client should I invoice from your tracked time?',
            },
          };
        }

        // Resolve client via the shared exact-then-substring helper.
        const resolution = await resolveClientByHint(ctx.tenantId, clientNameHint);
        const candidates = resolution.candidates;
        if (candidates.length === 0) {
          return {
            stepId: step.id,
            success: true,
            data: {
              kind: 'needs_clarify',
              question: `I don't have a client named "${clientNameHint}" on file. Add them first or pick a different name.`,
            },
          };
        }
        if (candidates.length > 1) {
          return {
            stepId: step.id,
            success: true,
            data: {
              kind: 'ambiguous',
              clientNameHint,
              candidates: candidates.map((c) => ({ id: c.id, name: c.name, email: c.email })),
              dateHint: dateHint || 'this month',
            },
          };
        }

        const client = { id: candidates[0].id, name: candidates[0].name, email: candidates[0].email };

        // Resolve date range using the tenant timezone.
        const tenantConfig = await db.abTenantConfig.findUnique({
          where: { userId: ctx.tenantId },
          select: { timezone: true },
        });
        const tz = tenantConfig?.timezone || 'UTC';
        const range = parseDateHint(dateHint, tz);

        const entries = await db.abTimeEntry.findMany({
          where: {
            tenantId: ctx.tenantId,
            clientId: client.id,
            billed: false,
            billable: true,
            startedAt: { gte: range.startDate, lt: range.endDate },
          },
          orderBy: { startedAt: 'asc' },
        });
        if (entries.length === 0) {
          return {
            stepId: step.id,
            success: true,
            data: {
              kind: 'no_entries',
              clientName: client.name,
              dateHint: dateHint || 'this month',
            },
          };
        }

        const rows: TimeEntryRow[] = entries.map((e) => ({
          id: e.id,
          // Bucket by tenant-local calendar day.
          date: (() => {
            try {
              return new Intl.DateTimeFormat('en-CA', {
                timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
              }).format(e.startedAt);
            } catch {
              return e.startedAt.toISOString().slice(0, 10);
            }
          })(),
          description: e.description || '',
          durationMinutes: e.durationMinutes || 0,
          hourlyRateCents: e.hourlyRateCents,
        }));
        const aggregated = aggregateByDay(rows);
        const totalMinutes = entries.reduce((s, e) => s + (e.durationMinutes || 0), 0);

        // Reject zero-rate invoices at the consumer: aggregated lines all at
        // 0¢ means every input entry had `hourlyRateCents == null`. Creating
        // a $0 draft and showing the user "Draft ready — total $0" with no
        // explanation is worse than failing closed with a fixable message.
        if (aggregated.length > 0 && aggregated.every((l) => l.rateCents === 0)) {
          return {
            stepId: step.id,
            success: false,
            error: `These entries don't have an hourly rate set yet — set one on ${client.name} first, then try again.`,
          };
        }

        // Determine the "headline" rate: if every entry shares the same
        // non-null rate, use it; otherwise mark "varied".
        const rateSet = new Set<number>();
        for (const e of entries) {
          if (e.hourlyRateCents != null) rateSet.add(e.hourlyRateCents);
        }
        const headlineRateCents = rateSet.size === 1 ? Array.from(rateSet)[0] : null;

        const draft = await createInvoiceDraft({
          tenantId: ctx.tenantId,
          client,
          parsed: {
            lines: aggregated.map((line) => ({
              description: line.description,
              rateCents: line.rateCents,
              quantity: line.quantity,
            })),
          },
          source: 'telegram',
        });

        // Mark the entries we just consumed as billed. Scoping by
        // `billed=false` guards against a concurrent invoice-from-timer
        // pass having already claimed any of these rows.
        //
        // Atomicity: createInvoiceDraft already committed its own transaction.
        // If the updateMany below fails (network blip, deadlock) we'd be left
        // with a draft AND still-unbilled entries — re-running would create
        // a duplicate invoice. Compensate by voiding the draft so retry is
        // safe. The void itself is best-effort: if it fails we log and let
        // the original error propagate.
        const entryIds = entries.map((e) => e.id);
        try {
          await db.abTimeEntry.updateMany({
            where: { id: { in: entryIds }, tenantId: ctx.tenantId, billed: false },
            data: { billed: true, invoiceId: draft.draftId },
          });
        } catch (err) {
          // Status value is 'void' to match the rest of the codebase
          // (see /invoices/[id]/void/route.ts).
          await db.abInvoice
            .updateMany({
              where: { id: draft.draftId, tenantId: ctx.tenantId },
              data: { status: 'void' },
            })
            .catch((voidErr) => {
              console.error(
                '[invoice.from_timer] failed to void draft after updateMany error',
                { draftId: draft.draftId, voidErr },
              );
            });
          throw err;
        }

        return {
          stepId: step.id,
          success: true,
          data: {
            kind: 'draft_created',
            draftId: draft.draftId,
            invoiceNumber: draft.invoiceNumber,
            clientName: draft.clientName,
            clientEmail: draft.clientEmail,
            totalCents: draft.totalCents,
            currency: draft.currency,
            dueDate: draft.dueDate,
            issuedDate: draft.issuedDate,
            entryCount: entries.length,
            totalMinutes,
            headlineRateCents,
            lineCount: aggregated.length,
            entryIdsConsumed: entryIds,
          },
        };
      }

      // ─── Mileage (PR 4) ──────────────────────────────────────────
      case 'mileage.record': {
        const miles = step.args.miles as number | undefined;
        const unitArg = step.args.unit as 'mi' | 'km' | undefined;
        const purposeRaw = (step.args.purpose as string | undefined) || 'Business travel';
        const clientNameHint = step.args.clientNameHint as string | undefined;
        if (!miles || miles <= 0) {
          return { stepId: step.id, success: false, error: 'miles must be positive' };
        }

        // Snapshot the tenant's jurisdiction at booking time. CRA tier
        // selection rolls forward from the YTD-before-this-trip total.
        const cfg = await db.abTenantConfig.findUnique({
          where: { userId: ctx.tenantId },
          select: { jurisdiction: true },
        });
        const jurisdiction: 'us' | 'ca' = cfg?.jurisdiction === 'ca' ? 'ca' : 'us';
        const date = new Date();
        const year = date.getUTCFullYear();
        const unit: 'mi' | 'km' = unitArg || (jurisdiction === 'ca' ? 'km' : 'mi');

        let ytd = 0;
        if (jurisdiction === 'ca') {
          // YTD-before-this-trip: filter on `date < trip-date` (not the
          // year-end boundary) so a backdated trip doesn't accidentally
          // see future km in its tier picker.
          const start = new Date(Date.UTC(year, 0, 1));
          const rows = await db.abMileageEntry.findMany({
            where: { tenantId: ctx.tenantId, unit, date: { gte: start, lt: date } },
            select: { miles: true },
          });
          ytd = rows.reduce((s, r) => s + r.miles, 0);
        }
        const rate = getMileageRate(jurisdiction, year, ytd);
        const deductibleAmountCents = Math.round(miles * rate.ratePerUnitCents);

        // Bind to a client when the hint resolves to exactly one match;
        // ambiguous picker is out-of-scope for the MVP record path.
        let clientId: string | null = null;
        let clientName: string | null = null;
        if (clientNameHint) {
          const resolution = await resolveClientByHint(ctx.tenantId, clientNameHint);
          if (resolution.candidates.length === 1) {
            clientId = resolution.candidates[0].id;
            clientName = resolution.candidates[0].name;
          }
        }

        // Resolve accounts for the JE (best-effort — if the chart
        // isn't seeded we still save the entry). Shared helper so the
        // route, the PATCH service, and the bot all use the same lookup.
        const accounts = await resolveVehicleAccounts(ctx.tenantId);

        // Cap purpose at 500 chars to match the route validation —
        // the bot is a write path too, so the constraint applies here.
        const purpose = (purposeRaw.trim() || 'Business travel').slice(0, 500);

        const created = await db.$transaction(async (tx) => {
          let journalEntryId: string | null = null;
          if (accounts && deductibleAmountCents > 0) {
            const memo = `Mileage: ${miles} ${unit} — ${purpose}`;
            const je = await tx.abJournalEntry.create({
              data: {
                tenantId: ctx.tenantId,
                date,
                memo,
                sourceType: 'mileage',
                verified: true,
                lines: {
                  create: [
                    {
                      accountId: accounts.vehicleAccountId,
                      debitCents: deductibleAmountCents,
                      creditCents: 0,
                      description: `Mileage @ ${rate.ratePerUnitCents}¢/${rate.unit}`,
                    },
                    {
                      accountId: accounts.equityAccountId,
                      debitCents: 0,
                      creditCents: deductibleAmountCents,
                      description: 'Personal vehicle, no cash outlay',
                    },
                  ],
                },
              },
            });
            journalEntryId = je.id;
          }
          const entry = await tx.abMileageEntry.create({
            data: {
              tenantId: ctx.tenantId,
              date,
              miles,
              unit,
              purpose,
              clientId,
              jurisdiction,
              ratePerUnitCents: rate.ratePerUnitCents,
              deductibleAmountCents,
              journalEntryId,
            },
          });
          if (journalEntryId) {
            await tx.abJournalEntry.update({
              where: { id: journalEntryId },
              data: { sourceId: entry.id },
            });
          }
          await tx.abEvent.create({
            data: {
              tenantId: ctx.tenantId,
              eventType: 'mileage.recorded',
              actor: 'agent',
              action: {
                mileageEntryId: entry.id,
                miles,
                unit,
                jurisdiction,
                ratePerUnitCents: rate.ratePerUnitCents,
                deductibleAmountCents,
                source: 'telegram',
              },
            },
          });
          return entry;
        });

        return {
          stepId: step.id,
          success: true,
          data: {
            kind: 'recorded',
            entryId: created.id,
            miles,
            unit,
            purpose,
            clientName,
            clientNameHint: clientNameHint || null,
            jurisdiction,
            ratePerUnitCents: rate.ratePerUnitCents,
            deductibleAmountCents,
            rateReason: rate.reason,
            journalPosted: !!created.journalEntryId,
          },
        };
      }

      case 'meta.help': {
        return { stepId: step.id, success: true };
      }

      case 'meta.clarify': {
        return {
          stepId: step.id,
          success: true,
          data: {
            question: step.args.question as string,
            candidates: step.args.candidates as string[],
          },
        };
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
      reply: 'I can record expenses ("spent $45 on gas at Shell"), book uploaded receipts (just send a photo), and answer questions about your books — try "balance", "invoices", "expenses", or "tax". After a receipt I read out the totals and you can reply naturally — "yep", "actually it\'s personal", "should be Meals", "fix it to $45", "scratch that" — and I\'ll update it.',
      parseMode: undefined,
      learned,
      delegatedToBrain: false,
      needsKeyboard: false,
    };
  }

  if (intent.intent === 'undo_last') {
    const r = results[0];
    if (!r?.success) {
      return {
        reply: r?.error || 'Couldn\'t undo that one.',
        parseMode: undefined,
        learned,
        delegatedToBrain: false,
        needsKeyboard: false,
      };
    }
    const data = r.data as { previousStatus?: string; vendorName?: string | null; amountCents?: number; wasAlready?: boolean } | undefined;
    if (data?.wasAlready) {
      return {
        reply: '📭 Already rejected — nothing to undo.',
        parseMode: undefined,
        learned,
        delegatedToBrain: false,
        needsKeyboard: false,
      };
    }
    const vendor = data?.vendorName ? escHtml(data.vendorName) : 'that one';
    const amt = data?.amountCents ? fmtUsd(data.amountCents) : '';
    const action = data?.previousStatus === 'confirmed'
      ? `posted a reversing entry for <b>${vendor}</b> ${amt} — it\'s off the books now.`
      : `tossed the draft for <b>${vendor}</b> ${amt}.`;
    return {
      reply: `↩️ Undone — ${action} What's next?`,
      parseMode: 'HTML',
      learned: [{ what: `undo ${data?.previousStatus}`, outcome: 'reversed' }],
      delegatedToBrain: false,
      needsKeyboard: false,
    };
  }

  if (intent.intent === 'update_amount') {
    const r = results[0];
    if (!r?.success) {
      return {
        reply: r?.error || 'Couldn\'t fix the amount.',
        parseMode: undefined,
        learned,
        delegatedToBrain: false,
        needsKeyboard: false,
      };
    }
    const data = r.data as { previousAmount?: number; newAmount?: number; unchanged?: boolean } | undefined;
    if (data?.unchanged) {
      return {
        reply: '🤷 That\'s already the amount on file — no change made.',
        parseMode: undefined,
        learned,
        delegatedToBrain: false,
        needsKeyboard: false,
      };
    }
    const updated = ctx.active ? { ...ctx.active, amountCents: data?.newAmount ?? ctx.active.amountCents } : null;
    if (!updated) {
      return { reply: '🤔 No active expense to update.', parseMode: undefined, learned, delegatedToBrain: false, needsKeyboard: false };
    }
    const lead = data?.previousAmount && data?.newAmount
      ? `🔧 Updated amount: <b>${fmtUsd(data.previousAmount)}</b> → <b>${fmtUsd(data.newAmount)}</b>${ctx.active?.status === 'confirmed' ? ' (posted reversing + replacement entries)' : ''}.`
      : `🔧 Updated.`;
    return {
      reply: summary(updated, lead),
      parseMode: 'HTML',
      learned: [{ what: 'amount fix', outcome: 'reversed-and-reposted' }],
      delegatedToBrain: false,
      needsKeyboard: false,
    };
  }

  if (intent.intent === 'create_invoice_from_chat') {
    const r = results[0];
    if (!r?.success) {
      return {
        reply: r?.error || 'Couldn\'t draft that invoice.',
        parseMode: undefined,
        learned,
        delegatedToBrain: false,
        needsKeyboard: false,
      };
    }
    // The webhook adapter inspects results[0].data and renders the
    // friendly preview + inline keyboard (Send/Edit/Cancel or
    // ambiguous-picker). We hand back an empty reply with
    // needsKeyboard=true so the adapter knows it owns the response.
    return {
      reply: '',
      parseMode: undefined,
      learned,
      delegatedToBrain: false,
      needsKeyboard: true,
    };
  }

  // Timer + invoice-from-timer (PR 2) + record_mileage (PR 4): same
  // handoff pattern as create_invoice_from_chat — the webhook renders
  // rich, keyboarded replies.
  if (
    intent.intent === 'start_timer' ||
    intent.intent === 'stop_timer' ||
    intent.intent === 'timer_status' ||
    intent.intent === 'invoice_from_timer' ||
    intent.intent === 'record_mileage'
  ) {
    const r = results[0];
    if (!r?.success) {
      return {
        reply: r?.error || 'Couldn\'t reach the timer.',
        parseMode: undefined,
        learned,
        delegatedToBrain: false,
        needsKeyboard: false,
      };
    }
    return {
      reply: '',
      parseMode: undefined,
      learned,
      delegatedToBrain: false,
      needsKeyboard: true,
    };
  }

  if (intent.intent === 'clarify') {
    const result = results[0];
    const question = (result?.data as { question?: string } | undefined)?.question
      || intent.slots.clarifyingQuestion
      || 'Could you say that another way?';
    return {
      reply: `🤔 ${question}`,
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
