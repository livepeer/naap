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
import { parseRecurringFromText } from './agentbook-recurring-parser';
import {
  parseCreateEstimateFromText,
  formatEstimateNumber,
  parseEstimateNumberSuffix,
} from './agentbook-estimate-parser';
import { parseDateHint, aggregateByDay, type TimeEntryRow } from './agentbook-time-aggregator';
import { resolveClientByHint } from './agentbook-client-resolver';
import { getMileageRate } from './agentbook-mileage-rates';
import { resolveVehicleAccounts } from './agentbook-account-resolver';
import { lookupPerDiem, CONUS_DEFAULT_MIE_CENTS } from './agentbook-perdiem-rates';
import { computeQuarterlyDeductible, computeRatio } from './agentbook-home-office';

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
  | 'generate_tax_package' // "give me my 2025 tax package" → render PDF/CSV/ZIP (PR 5)
  | 'setup_recurring_invoice' // "every month invoice TechCorp $5K consulting" → schedule (PR 6)
  | 'create_estimate'   // "estimate Beta $4K for new website" → AbEstimate (PR 7)
  | 'convert_estimate'  // "convert estimate EST-… to invoice" → AbInvoice (PR 7)
  | 'set_budget'        // "max $200 on meals each month" → AbBudget upsert (PR 8)
  | 'invite_cpa'        // "invite my CPA jane@cpa.test" → AbTenantAccess + magic link (PR 11)
  | 'record_per_diem'   // "per-diem 3 days NYC May 5–7" → 3 AbExpense rows at GSA M&IE rate (PR 14)
  | 'log_home_office'   // "Q2 home office: utilities $400, internet $90, rent $3000" → 1+ AbExpense rows for the deductible portion (PR 15)
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
  // Tax-package slots (PR 5):
  taxYear?: number;            // calendar year, defaults to last year if absent
  jurisdiction?: 'us' | 'ca';  // tenant jurisdiction (resolved at execute time)
  // Recurring-invoice slots (PR 6):
  cadence?: 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'annual';
  dayOfMonth?: number;         // 1-31, optional
  autoSend?: boolean;          // auto-send invoice on generation, default false
  // Estimate slots (PR 7):
  validUntilHint?: string;     // ISO date or phrase ("60 days")
  estimateNumberHint?: string; // EST-YYYY-XXXX
  estimateIdHint?: string;     // raw uuid (rare — used by callbacks)
  useMostRecent?: boolean;     // "convert the most recent estimate to invoice"
  // Budget slots (PR 8):
  categoryNameHint?: string;          // raw category text from the user ("meals")
  budgetPeriod?: 'monthly' | 'quarterly' | 'annual';
  // CPA invite slots (PR 11):
  cpaEmail?: string;                  // extracted email (e.g. "jane@cpa.test")
  cpaRole?: 'cpa' | 'bookkeeper' | 'viewer';
  // Per-diem slots (PR 14):
  cityHint?: string;                  // raw city text the user mentioned ("NYC", "San Fran")
  days?: number;                      // explicit day count when given ("per-diem 3 days NYC")
  startDate?: string;                 // ISO YYYY-MM-DD when parseable
  endDate?: string;                   // ISO YYYY-MM-DD when parseable
  perDiemOption?: 'mie_only' | 'lodging_and_mie';
  // Home-office slots (PR 15):
  hoQuarter?: number;                  // 1-4 inferred from "Q2", "second quarter", or current month
  hoYear?: number;                     // calendar year — defaults to "the year the quarter belongs to"
  utilitiesCents?: number;             // $400 → 40_000
  internetCents?: number;              // $90 → 9_000
  rentInterestCents?: number;          // $3000 → 300_000 (rent OR mortgage interest)
  insuranceCents?: number;             // $90 → 9_000 (renters / homeowners)
  otherHomeOfficeCents?: number;       // catch-all for "+ $X repairs" etc
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

export interface ConversationHint {
  /** What the bot said last turn (truncated). */
  lastBotMessage?: string | null;
  /** Short label of the last topic — 'review_queue', 'invoice_draft', etc. */
  lastBotTopic?: string | null;
  /** Things the bot just listed (so the LLM can resolve "the second one"). */
  mentionedEntities?: Array<{ index: number; kind: string; label: string; shortCode?: string }>;
  /** Multi-turn slot fill the bot is waiting on. */
  pendingSlots?: {
    intent: string;
    filled: Record<string, unknown>;
    awaiting: string;
  } | null;
}

export interface BotContext {
  tenantId: string;
  active: ActiveExpense | null;
  categories: CategoryRow[];
  /** Optional conversational memory. When absent, the bot behaves stateless. */
  conversation?: ConversationHint;
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

  // Conversation memory: the LLM sees what the bot just said + any
  // entities it listed + any pending slot fill. This is what lets
  // "the second one" / "INV-007" / "yes" resolve to a concrete action.
  const conv = ctx.conversation;
  const convBlock = conv
    ? [
        conv.lastBotMessage ? `Last bot message: "${conv.lastBotMessage}"` : '',
        conv.lastBotTopic ? `Last bot topic: ${conv.lastBotTopic}` : '',
        conv.mentionedEntities && conv.mentionedEntities.length > 0
          ? `Things the bot just listed (user may refer to these by number, short code, or substring):\n${conv.mentionedEntities
              .map((e) => `   ${e.index}. [${e.kind}] ${e.label}${e.shortCode ? ` (${e.shortCode})` : ''}`)
              .join('\n')}`
          : '',
        conv.pendingSlots
          ? `The bot is waiting for the user to fill slot "${conv.pendingSlots.awaiting}" for intent "${conv.pendingSlots.intent}". Already-filled slots: ${JSON.stringify(conv.pendingSlots.filled)}.`
          : '',
      ].filter(Boolean).join('\n')
    : '(no recent conversation context)';

  const systemPrompt = `You are an intent classifier for AgentBook, a friendly bookkeeping
assistant on Telegram for freelancers. Read the user's message + the
context below and identify what they want to do.

CONTEXT
Active expense (the most recent receipt the user is looking at):
   ${activeBlock}
Available expense categories: ${ctx.categories.map((c) => c.name).join(', ') || '(no categories — chart of accounts not seeded yet)'}

Conversation memory:
${convBlock}

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
   generate_tax_package — user wants the year-end tax package (PDF + CSV
                     bundle for their accountant). Triggers contain words
                     like "tax package" / "year-end package" / "annual
                     report" / "tax bundle" optionally followed by a 4-digit
                     year. SET slots.taxYear to the year if mentioned;
                     otherwise leave it absent and the executor defaults
                     to last year.
                     ("give me my 2025 tax package",
                      "year-end package for 2024",
                      "send me my annual tax report")
   setup_recurring_invoice — user wants to set up a recurring invoice
                     schedule (auto-issued every week/month/quarter/year).
                     Triggers: "every month invoice X $Y", "set up
                     monthly $Y subscription for X", "schedule a
                     quarterly invoice for X $Y", "create a recurring
                     invoice for X $Y". DO NOT pick this for a one-off
                     "invoice X $Y" — only when the user signals a
                     repeating cadence ("every", "each", "monthly",
                     "weekly", "quarterly", "biweekly", "annually",
                     "recurring"). SET slots.cadence to one of: weekly /
                     biweekly / monthly / quarterly / annual. SET
                     slots.amountCents to the per-period total in cents.
                     SET slots.clientNameHint to the raw client name.
                     SET slots.description to the work description if
                     present. SET slots.dayOfMonth if "on the Nth".
                     ("every month invoice TechCorp $5K consulting on the 1st",
                      "set up monthly $1K subscription for Acme",
                      "schedule a quarterly invoice for Beta $3K")
   create_estimate — user wants to draft an estimate / quote (NOT a real
                     invoice yet — clients approve estimates before they
                     get billed). Triggers: "estimate <client> $<amt> for
                     <desc>", "quote <client> $<amt>". SET
                     slots.clientNameHint to the client, slots.amountCents
                     to the total, slots.description to the work, and
                     slots.validUntilHint to a date/phrase if mentioned
                     ("valid 60 days", "valid until 2026-06-30").
                     IMPORTANT: do NOT pick this when the user said
                     "invoice" or "bill" — those are PR 1's
                     create_invoice_from_chat.
                     ("estimate Beta $4K for new website",
                      "quote Acme $10K for redesign valid 60 days")
   set_budget      — user wants to cap spend on a category for a period.
                     Triggers: "max $200 on meals each month", "set $500
                     monthly travel budget", "limit office supplies to
                     $100/mo", "cap groceries at $400 monthly". SET
                     slots.amountCents to the limit in cents,
                     slots.categoryNameHint to the raw category text
                     ("meals" / "travel" / "office supplies"), and
                     slots.budgetPeriod to "monthly" | "quarterly" |
                     "annual" (default monthly when not specified).
                     ("max $200 on meals each month",
                      "set $500 monthly travel budget",
                      "limit office supplies to $100/mo")
   convert_estimate — user wants to turn an APPROVED estimate into an
                     invoice. Triggers: "convert estimate EST-... to
                     invoice", "make EST-... an invoice", "turn the most
                     recent estimate into an invoice". SET
                     slots.estimateNumberHint to the EST-YYYY-XXXX
                     number if present, OR slots.useMostRecent=true if
                     they said "most recent" / "latest".
                     ("convert estimate EST-2026-003 to invoice",
                      "make EST-2026-AB12 an invoice",
                      "turn the latest estimate into an invoice")
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
   invite_cpa      — user wants to give their accountant / CPA / bookkeeper
                     read-only access to the books. Triggers: "invite my
                     CPA jane@cpa.test", "add my accountant
                     bob@example.com", "share access with my CPA at
                     name@firm.com". SET slots.cpaEmail to the lowercased
                     email and slots.cpaRole to "cpa" | "bookkeeper" |
                     "viewer" (default "cpa").
                     ("invite my CPA jane@cpa.test",
                      "add my accountant bob@firm.com",
                      "share access with my bookkeeper at p@books.com")
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
{"intent": "<name>", "slots": {"categoryName": "Fuel", "amountCents": 4523, "vendor": "Shell", "description": "...", "filter": "...", "clarifyingQuestion": "...", "candidateIntents": ["...", "..."], "miles": 47, "unit": "mi", "purpose": "TechCorp meeting", "clientNameHint": "TechCorp", "taxYear": 2025, "cadence": "monthly", "dayOfMonth": 1, "validUntilHint": "60 days", "estimateNumberHint": "EST-2026-003", "useMostRecent": true, "categoryNameHint": "meals", "budgetPeriod": "monthly"}, "confidence": 0.0-1.0, "reason": "<one short sentence>"}`;

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

  // Home-office quarterly (PR 15): "Q2 home office: utilities $400,
  // internet $90, rent $3000", "home office Q1 2026 utilities 400 …",
  // "home-office quarter: utils 400, internet 90, mortgage 3000".
  // Must run BEFORE the per-diem and record_expense paths because the
  // free-form "$400" amounts in the message would otherwise route to
  // record_expense.
  if (/\bhome[- ]office\b/i.test(text)) {
    const slots: IntentSlots = {};

    // Quarter — "Q1".."Q4" or "first/second/third/fourth quarter".
    const qMatch =
      text.match(/\bQ([1-4])\b/i)
      || text.match(/\b(first|second|third|fourth)\s+quarter\b/i);
    if (qMatch) {
      const raw = qMatch[1].toLowerCase();
      const ord: Record<string, number> = { first: 1, second: 2, third: 3, fourth: 4, '1': 1, '2': 2, '3': 3, '4': 4 };
      slots.hoQuarter = ord[raw];
    }
    // Year — explicit "2026" / "2025"; otherwise leave undefined and
    // let the executor infer.
    const yMatch = text.match(/\b(20\d{2})\b/);
    if (yMatch) slots.hoYear = parseInt(yMatch[1], 10);

    // Component amounts. Each pulls the first $-amount that follows
    // the keyword. Amounts are converted to cents (Math.round to
    // protect against floating-point drift on $X.YY values).
    const dollar = (s: string): number | null => {
      const m = s.match(/\$?\s*(\d+(?:[.,]\d{1,2})?)/);
      if (!m) return null;
      const n = parseFloat(m[1].replace(/,/g, ''));
      if (!isFinite(n) || n < 0) return null;
      return Math.round(n * 100);
    };

    const grab = (re: RegExp): number | undefined => {
      const m = text.match(re);
      if (!m) return undefined;
      const cents = dollar(m[1] || '');
      return cents == null ? undefined : cents;
    };

    slots.utilitiesCents = grab(/utilit(?:y|ies)\s*[:\-=]?\s*(\$?\s*\d+(?:[.,]\d{1,2})?)/i);
    slots.internetCents  = grab(/(?:internet|wi[- ]?fi|broadband)\s*[:\-=]?\s*(\$?\s*\d+(?:[.,]\d{1,2})?)/i);
    slots.rentInterestCents = grab(/(?:rent|mortgage(?:\s+interest)?|mort)\s*[:\-=]?\s*(\$?\s*\d+(?:[.,]\d{1,2})?)/i);
    slots.insuranceCents  = grab(/(?:insurance|ins)\s*[:\-=]?\s*(\$?\s*\d+(?:[.,]\d{1,2})?)/i);
    // "other $X" / "repairs $X" / "misc $X" — light catch-all.
    slots.otherHomeOfficeCents = grab(/(?:other|repairs?|maintenance|misc(?:\.|ellaneous)?)\s*[:\-=]?\s*(\$?\s*\d+(?:[.,]\d{1,2})?)/i);

    return {
      intent: 'log_home_office',
      slots,
      confidence: 0.9,
      reason: 'home-office trigger phrase',
      source: 'regex',
    };
  }

  // Per-diem (PR 14): "per-diem 3 days NYC", "perdiem NYC 5/5-5/7",
  // "per diem 2 days San Francisco", "per-diem 3 days NYC May 5–7".
  // Must run BEFORE the mileage regex because both can hit a
  // number-then-place pattern, and BEFORE record_expense because
  // "per-diem 3 days NYC" doesn't include a $ amount but we still
  // own the trigger word.
  if (/^(?:please\s+)?(?:per[- ]?diem|perdiem)\b/i.test(text)) {
    const slots: IntentSlots = {};
    // Strict shape first: "per-diem [N days] City [M/D[-M/D]]"
    const strict = text.match(
      /^(?:please\s+)?(?:per[- ]?diem|perdiem)\s+(?:(\d+)\s+days?\s+)?([\w\s.&'\-]+?)(?:\s+(\d{1,2}\/\d{1,2})(?:\s*[-–to]+\s*(\d{1,2}\/\d{1,2}))?)?\s*$/i,
    );
    if (strict) {
      const daysRaw = strict[1];
      if (daysRaw) {
        const d = parseInt(daysRaw, 10);
        if (isFinite(d) && d > 0 && d <= 365) slots.days = d;
      }
      const cityRaw = (strict[2] || '').trim().replace(/[.!?,]+$/, '');
      if (cityRaw) slots.cityHint = cityRaw;
      const startRaw = strict[3];
      const endRaw = strict[4];
      if (startRaw) {
        const iso = mmddToIso(startRaw);
        if (iso) slots.startDate = iso;
      }
      if (endRaw) {
        const iso = mmddToIso(endRaw);
        if (iso) slots.endDate = iso;
      }
    }
    // Even when the strict regex captured a city, it may have absorbed
    // a trailing verbal-date fragment (the city group is `[\w\s]+?`
    // without exclusions). Strip "May 5–7" / "May 5-7" / "this week"
    // tails from the captured cityHint so the lookup table doesn't
    // fail on "NYC May 5-7".
    if (slots.cityHint) {
      let c = slots.cityHint;
      c = c.replace(
        /\s+(?:on\s+)?(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s*(\d{1,2})(?:\s*[-–to]+\s*(\d{1,2}))?\s*$/i,
        '',
      );
      c = c.replace(/\s+(?:this|next|last)\s+(?:week|month)\s*$/i, '');
      c = c.replace(/[.!?,]+$/, '').trim();
      slots.cityHint = c || slots.cityHint;
    }
    if (!slots.cityHint) {
      // Loose fallback: strip leading verb + any "N days" + trailing
      // date-ish words ("May 5–7", "5/5-5/7", "this week"). What's left
      // is the city hint. Days are pulled from the same pattern as a
      // best-effort, but we don't refuse to classify if any of these
      // sub-extractions miss.
      let stripped = text.replace(/^(?:please\s+)?(?:per[- ]?diem|perdiem)\s+/i, '').trim();
      const daysRe = /^(\d+)\s+days?\s+/i;
      const daysMatch = stripped.match(daysRe);
      if (daysMatch) {
        const d = parseInt(daysMatch[1], 10);
        if (isFinite(d) && d > 0 && d <= 365) slots.days = d;
        stripped = stripped.replace(daysRe, '');
      }
      // Strip trailing date phrases: "M/D[-M/D]" or
      // "Jan|Feb|Mar|... D[-D]".
      stripped = stripped.replace(
        /\s+(?:on\s+)?(?:(\d{1,2}\/\d{1,2})(?:\s*[-–to]+\s*\d{1,2}\/\d{1,2})?)\s*$/i,
        (_m, iso1: string) => {
          const isoStart = mmddToIso(iso1);
          if (isoStart) slots.startDate = isoStart;
          return '';
        },
      );
      stripped = stripped.replace(
        /\s+(?:on\s+)?(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s*\d{1,2}(?:\s*[-–to]+\s*\d{1,2})?\s*$/i,
        '',
      );
      stripped = stripped.replace(/\s+(?:this|next|last)\s+(?:week|month)\s*$/i, '');
      stripped = stripped.replace(/[.!?,]+$/, '').trim();
      if (stripped) slots.cityHint = stripped;
    }
    return {
      intent: 'record_per_diem',
      slots,
      confidence: 0.9,
      reason: 'per-diem trigger phrase',
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

  // Tax package (PR 5): "give me my 2025 tax package", "year-end report
  // for 2024", "annual tax bundle". The year is optional — when absent the
  // executor falls back to the previous calendar year (the typical use
  // case: filing this year for last year's books).
  // 'annual' alone (without 'tax') was producing a false positive on
  // Quickbooks-style "annual report" requests; require an explicit
  // tax/year-end qualifier OR 'annual tax'.
  const taxPkgMatch = text.match(
    /\b(?:tax|year[\- ]end|annual\s+tax)\s+(?:package|bundle|report|filing)\s*(?:for)?\s*(\d{4})?/i,
  );
  if (taxPkgMatch) {
    const yearRaw = taxPkgMatch[1];
    const slots: IntentSlots = {};
    if (yearRaw) {
      const y = parseInt(yearRaw, 10);
      if (isFinite(y) && y >= 2000 && y <= 2100) slots.taxYear = y;
    }
    return {
      intent: 'generate_tax_package',
      slots,
      confidence: 0.92,
      reason: 'tax/year-end/annual + package/bundle/report',
      source: 'regex',
    };
  }

  // CPA invite (PR 11): "invite my CPA jane@cpa.test", "add my
  // accountant jane@cpa.test", "invite cpa jane@cpa.test". Captures
  // the email; defaults role to 'cpa'. Runs BEFORE the budget /
  // recurring-invoice regexes because the verb "invite" is unique to
  // this flow and we don't want a stray "$" elsewhere in the message
  // to bleed into a budget match.
  const inviteCpaMatch = text.match(
    /^(?:please\s+)?(?:invite|add)\s+(?:my\s+)?(?:cpa|accountant|bookkeeper)\s+([\w.+-]+@[\w.-]+\.\w+)/i,
  );
  if (inviteCpaMatch) {
    const lowerText = text.toLowerCase();
    const role: 'cpa' | 'bookkeeper' | 'viewer' = /\bbookkeeper\b/.test(lowerText)
      ? 'bookkeeper'
      : 'cpa';
    return {
      intent: 'invite_cpa',
      slots: { cpaEmail: inviteCpaMatch[1].toLowerCase(), cpaRole: role },
      confidence: 0.95,
      reason: 'invite/add + cpa/accountant + email',
      source: 'regex',
    };
  }

  // Set budget (PR 8). Two trigger shapes:
  //   • "max|limit|set|cap $N on|for <category> [per|each|every month|year|quarter | monthly | annually | quarterly]"
  //   • "set|create $N monthly|quarterly|annual <category> budget"
  // The amount can include a "k"/"K" suffix (treated as $·1000). The
  // period defaults to monthly when no cadence word is present. Must
  // run BEFORE the recurring-invoice regex below — phrases like "set
  // $500 monthly travel budget" share the "monthly" + "set" tokens but
  // never mention "invoice", so we own the "budget" / "cap on" /
  // "limit … to $X" surface area.
  const budgetMatch = parseSetBudgetFromText(text);
  if (budgetMatch) {
    return {
      intent: 'set_budget',
      slots: {
        amountCents: budgetMatch.amountCents,
        categoryNameHint: budgetMatch.categoryNameHint,
        budgetPeriod: budgetMatch.period,
      },
      confidence: 0.9,
      reason: 'budget cap trigger phrase',
      source: 'regex',
    };
  }

  // Recurring invoice setup (PR 6). Must run BEFORE the generic
  // create_invoice_from_chat trigger below — phrases like "every month
  // invoice TechCorp" otherwise get parsed as one-off invoices.
  // Two trigger shapes:
  //   • "every|each|monthly|weekly|… ... invoice ..."
  //   • "set up|schedule|create [a/an] weekly|biweekly|monthly|… invoice"
  const recurringTrigger =
    /\b(?:every|each|monthly|weekly|quarterly|biweekly|bi-weekly|annually|annual|yearly|recurring)\b.*\binvoice\b/i;
  const recurringSetupTrigger =
    /^(?:please\s+|can you\s+)?(?:set\s+up|schedule|create)\s+(?:an?\s+)?(?:weekly|biweekly|bi-weekly|monthly|quarterly|annual|yearly|recurring)\s+(?:recurring\s+)?invoice/i;
  if (recurringTrigger.test(text) || recurringSetupTrigger.test(text)) {
    return {
      intent: 'setup_recurring_invoice',
      slots: { description: text },
      confidence: 0.85,
      reason: 'recurring/cadence + invoice trigger',
      source: 'regex',
    };
  }

  // Estimate flow (PR 7). Order matters:
  //   1. convert_estimate — "convert estimate EST-... to invoice" / "make
  //      EST-... an invoice" / "turn the most recent estimate into an
  //      invoice". Must beat the generic "invoice ..." trigger below
  //      because the verb is "convert"/"make"/"turn" not "invoice".
  //   2. create_estimate — "estimate Beta $4K for new website". Must
  //      beat the generic "invoice ..." trigger so the verb "estimate"
  //      doesn't get re-routed to create_invoice_from_chat.
  // Both run BEFORE PR 1's create_invoice_from_chat regex.
  if (
    /\b(?:convert|turn|make|change)\b/i.test(text)
    && /\binvoice\b/i.test(text)
    && (/\bEST-\d{4}-[A-Z0-9]{3,8}\b/i.test(text) || /\b(?:most\s+recent|latest|last)\s+estimate\b/i.test(text) || /\bestimate\b/i.test(text))
  ) {
    const numMatch = text.match(/\bEST-\d{4}-[A-Z0-9]{3,8}\b/i);
    const slots: IntentSlots = {};
    if (numMatch) slots.estimateNumberHint = numMatch[0].toUpperCase();
    else if (/\b(?:most\s+recent|latest|last)\s+estimate\b/i.test(text)) slots.useMostRecent = true;
    else {
      // Saw "convert ... estimate ... invoice" without an id and without
      // "most recent" — fall through to the generic invoice trigger or
      // unrelated. Don't claim this turn.
    }
    if (slots.estimateNumberHint || slots.useMostRecent) {
      return {
        intent: 'convert_estimate',
        slots,
        confidence: 0.9,
        reason: 'convert + estimate + invoice phrase',
        source: 'regex',
      };
    }
  }
  if (/^(?:please\s+|can you\s+)?(?:estimate|quote)\s+/i.test(text)) {
    return {
      intent: 'create_estimate',
      slots: { description: text },
      confidence: 0.85,
      reason: 'estimate/quote trigger phrase',
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

// ─── Budget regex helper (PR 8) ──────────────────────────────────────────

interface ParsedBudget {
  amountCents: number;
  categoryNameHint: string;
  period: 'monthly' | 'quarterly' | 'annual';
}

/**
 * Parse free-form budget commands. Recognised shapes:
 *
 *   • "max|limit|set|cap $N on|for <category> [per|each|every (month|quarter|year) | monthly | annually | quarterly]"
 *     — leading verb + amount + on/for + category
 *   • "max|limit|set|cap <category> to $N [per|each|every (month|quarter|year) | monthly | …]"
 *     — leading verb + category + to + amount  ("limit office supplies to $100/mo")
 *   • "set|create $N (monthly|quarterly|annual) <category> budget"
 *     — explicit "<category> budget" suffix
 *
 * Amount supports "$200", "200", "1.5k", "1,000". Period defaults to
 * monthly when no cadence word appears.
 *
 * Exported for unit-testing the regex without spinning up Gemini.
 */
export function parseSetBudgetFromText(text: string): ParsedBudget | null {
  const t = text.trim();
  if (!t) return null;

  // Shape A: "max $200 on meals each month" / "max 200 on meals monthly" /
  // "set $500 monthly travel budget"
  const re1 = /^(?:max|limit|set|cap)\s+\$?([\d,]+(?:\.\d+)?)\s*(k)?\s+(?:on|for)\s+(.+?)(?:\s+(?:per|each|every)\s+(month|year|quarter)|\s+(monthly|annually|quarterly|yearly)|\s*$)/i;
  const m1 = re1.exec(t);
  if (m1) {
    const amount = parseAmount(m1[1], m1[2]);
    if (amount == null) return null;
    const category = m1[3].trim().replace(/\b(?:budget|cap|limit)\b/gi, '').trim();
    const period = mapPeriod(m1[4] || m1[5]);
    if (!category) return null;
    return { amountCents: amount, categoryNameHint: category, period };
  }

  // Shape B: "limit office supplies to $100/mo" / "cap groceries at $400 monthly"
  const re2 = /^(?:max|limit|cap)\s+(.+?)\s+(?:to|at)\s+\$?([\d,]+(?:\.\d+)?)\s*(k)?\s*(?:\/\s*(mo|yr|qtr|q)|\s+(?:per|each|every)\s+(month|year|quarter)|\s+(monthly|annually|quarterly|yearly))?\s*$/i;
  const m2 = re2.exec(t);
  if (m2) {
    const category = m2[1].trim();
    const amount = parseAmount(m2[2], m2[3]);
    if (amount == null) return null;
    const slash = m2[4];
    const period = slash
      ? mapPeriod(slash === 'mo' ? 'month' : slash === 'yr' ? 'year' : 'quarter')
      : mapPeriod(m2[5] || m2[6]);
    return { amountCents: amount, categoryNameHint: category, period };
  }

  // Shape C: "set $500 monthly travel budget" / "create $300 quarterly meals budget"
  const re3 = /^(?:set|create)\s+\$?([\d,]+(?:\.\d+)?)\s*(k)?\s+(monthly|quarterly|annual|annually|yearly)\s+(.+?)\s+budget\s*$/i;
  const m3 = re3.exec(t);
  if (m3) {
    const amount = parseAmount(m3[1], m3[2]);
    if (amount == null) return null;
    const period = mapPeriod(m3[3]);
    const category = m3[4].trim();
    return { amountCents: amount, categoryNameHint: category, period };
  }
  return null;
}

/**
 * Convert "5/7" / "12/31" to ISO yyyy-mm-dd, defaulting to the current
 * calendar year. Returns null when month/day is out-of-range. Used by
 * the per-diem regex (PR 14) — we don't accept full ISO inputs at the
 * regex layer, but the executor accepts ISO directly when slots come
 * from the LLM classifier.
 */
function mmddToIso(raw: string): string | null {
  const m = raw.match(/^(\d{1,2})\/(\d{1,2})$/);
  if (!m) return null;
  const month = parseInt(m[1], 10);
  const day = parseInt(m[2], 10);
  if (!isFinite(month) || !isFinite(day)) return null;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const year = new Date().getUTCFullYear();
  const mm = String(month).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  return `${year}-${mm}-${dd}`;
}

function parseAmount(raw: string, kSuffix: string | undefined): number | null {
  const v = parseFloat(raw.replace(/,/g, ''));
  if (!isFinite(v) || v <= 0) return null;
  const dollars = kSuffix ? v * 1000 : v;
  return Math.round(dollars * 100);
}

function mapPeriod(
  raw: string | undefined,
): 'monthly' | 'quarterly' | 'annual' {
  if (!raw) return 'monthly';
  const r = raw.toLowerCase();
  if (r.startsWith('quarter') || r === 'q' || r === 'qtr') return 'quarterly';
  if (r === 'year' || r === 'yr' || r === 'annual' || r === 'annually' || r === 'yearly') {
    return 'annual';
  }
  return 'monthly';
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
    case 'generate_tax_package':
      return [{
        id,
        skill: 'tax.generate_package',
        args: {
          year: intent.slots.taxYear,
        },
        dependsOn: [],
      }];
    case 'setup_recurring_invoice':
      return [{
        id,
        skill: 'invoice.setup_recurring',
        args: {
          // Pass the raw user text — the executor parses cadence + amount
          // + client via the same Gemini-first/regex parser the LLM
          // classifier already used to fill slots, so we don't lose the
          // original phrasing on regex-source classifications.
          text: intent.slots.description || '',
          cadence: intent.slots.cadence,
          amountCents: intent.slots.amountCents,
          clientNameHint: intent.slots.clientNameHint,
          dayOfMonth: intent.slots.dayOfMonth,
          autoSend: intent.slots.autoSend,
          description: intent.slots.description,
        },
        dependsOn: [],
      }];
    case 'create_estimate':
      return [{
        id,
        skill: 'estimate.create',
        args: {
          // Mirrors invoice.create_from_chat: the executor re-parses the
          // raw text when slots are sparse (regex-source classifications).
          text: intent.slots.description || '',
          clientNameHint: intent.slots.clientNameHint,
          amountCents: intent.slots.amountCents,
          description: intent.slots.description,
          validUntilHint: intent.slots.validUntilHint,
        },
        dependsOn: [],
      }];
    case 'convert_estimate':
      return [{
        id,
        skill: 'estimate.convert',
        args: {
          estimateNumberHint: intent.slots.estimateNumberHint,
          estimateIdHint: intent.slots.estimateIdHint,
          useMostRecent: intent.slots.useMostRecent,
        },
        dependsOn: [],
      }];
    case 'set_budget':
      return [{
        id,
        skill: 'budget.set',
        args: {
          amountCents: intent.slots.amountCents,
          categoryNameHint: intent.slots.categoryNameHint,
          period: intent.slots.budgetPeriod,
        },
        dependsOn: [],
      }];
    case 'invite_cpa':
      return [{
        id,
        skill: 'cpa.invite',
        args: {
          email: intent.slots.cpaEmail,
          role: intent.slots.cpaRole || 'cpa',
        },
        dependsOn: [],
      }];
    case 'record_per_diem':
      return [{
        id,
        skill: 'per_diem.record',
        args: {
          cityHint: intent.slots.cityHint,
          days: intent.slots.days,
          startDate: intent.slots.startDate,
          endDate: intent.slots.endDate,
          option: intent.slots.perDiemOption || 'mie_only',
        },
        dependsOn: [],
      }];
    case 'log_home_office':
      return [{
        id,
        skill: 'home_office.log',
        args: {
          year: intent.slots.hoYear,
          quarter: intent.slots.hoQuarter,
          utilitiesCents: intent.slots.utilitiesCents,
          internetCents: intent.slots.internetCents,
          rentInterestCents: intent.slots.rentInterestCents,
          insuranceCents: intent.slots.insuranceCents,
          otherCents: intent.slots.otherHomeOfficeCents,
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

      // ─── Recurring invoice setup (PR 6) ──────────────────────────
      case 'invoice.setup_recurring': {
        // Resolve cadence + amount + client. Slot values from the LLM
        // classifier come through first; if any are missing we fall
        // back to parsing the raw text ourselves.
        const rawText = (step.args.text as string | undefined) || '';
        const slotCadence = step.args.cadence as
          | 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'annual'
          | undefined;
        const slotAmount = step.args.amountCents as number | undefined;
        const slotClient = step.args.clientNameHint as string | undefined;
        const slotDayOfMonth = step.args.dayOfMonth as number | undefined;
        const slotDescription = step.args.description as string | undefined;
        const autoSend = (step.args.autoSend as boolean | undefined) ?? false;

        let cadence = slotCadence;
        let amountCents = slotAmount;
        let clientNameHint = slotClient;
        let dayOfMonth = slotDayOfMonth;
        let description = slotDescription;

        // If any slot is missing, run the dedicated recurring parser
        // against the original text. The Gemini-first parser handles
        // both shapes ("every month..." and "schedule a monthly...").
        if (!cadence || !amountCents || !clientNameHint) {
          const parsed = await parseRecurringFromText(rawText);
          if (parsed) {
            cadence = cadence || parsed.cadence;
            amountCents = amountCents || parsed.amountCents;
            clientNameHint = clientNameHint || parsed.clientNameHint;
            dayOfMonth = dayOfMonth ?? parsed.dayOfMonth;
            description = description || parsed.description;
          }
        }

        if (!cadence) {
          return {
            stepId: step.id,
            success: true,
            data: {
              kind: 'needs_clarify',
              question: "How often should I issue this invoice — weekly, biweekly, monthly, quarterly, or annual?",
            },
          };
        }
        if (!amountCents || amountCents <= 0) {
          return {
            stepId: step.id,
            success: true,
            data: {
              kind: 'needs_clarify',
              question: "How much should each invoice be? Try \"every month invoice Acme $5K for consulting\".",
            },
          };
        }
        if (!clientNameHint) {
          return {
            stepId: step.id,
            success: true,
            data: {
              kind: 'needs_clarify',
              question: "Which client should I bill? Try \"every month invoice Acme $5K for consulting\".",
            },
          };
        }

        // Resolve client. Same exact-then-substring helper as the
        // one-off invoice path — must match exactly one client; ambiguous
        // matches re-prompt the user.
        const resolution = await resolveClientByHint(ctx.tenantId, clientNameHint);
        const candidates = resolution.candidates;
        if (candidates.length === 0) {
          return {
            stepId: step.id,
            success: true,
            data: {
              kind: 'needs_clarify',
              question: `I don't have a client named "${clientNameHint}" on file. Add them first, then try again.`,
            },
          };
        }
        if (candidates.length > 1) {
          return {
            stepId: step.id,
            success: true,
            data: {
              kind: 'needs_clarify',
              question: `Which "${clientNameHint}" did you mean — ${candidates.slice(0, 6).map((c) => c.name).join(' or ')}?`,
            },
          };
        }
        const client = candidates[0];

        // Compute the next-due date. dayOfMonth (when present) anchors
        // monthly/quarterly/annual cadences to a specific calendar day.
        const now = new Date();
        const nextDue = new Date(now);
        if (dayOfMonth && (cadence === 'monthly' || cadence === 'quarterly' || cadence === 'annual')) {
          // Set to the requested day of *this* month if still upcoming;
          // otherwise next month for monthly, +3 months for quarterly,
          // +1 year for annual. Clamp dayOfMonth to the month's last day
          // to avoid JS Date's silent rollover (e.g., setDate(31) in Feb).
          const daysInThisMonth = new Date(nextDue.getFullYear(), nextDue.getMonth() + 1, 0).getDate();
          nextDue.setDate(Math.min(dayOfMonth, daysInThisMonth));
          if (nextDue <= now) {
            switch (cadence) {
              case 'monthly': nextDue.setMonth(nextDue.getMonth() + 1); break;
              case 'quarterly': nextDue.setMonth(nextDue.getMonth() + 3); break;
              case 'annual': nextDue.setFullYear(nextDue.getFullYear() + 1); break;
            }
          }
        } else {
          // No day-of-month anchor — fire on the next cadence boundary
          // starting from today.
          switch (cadence) {
            case 'weekly': nextDue.setDate(nextDue.getDate() + 7); break;
            case 'biweekly': nextDue.setDate(nextDue.getDate() + 14); break;
            case 'monthly': nextDue.setMonth(nextDue.getMonth() + 1); break;
            case 'quarterly': nextDue.setMonth(nextDue.getMonth() + 3); break;
            case 'annual': nextDue.setFullYear(nextDue.getFullYear() + 1); break;
          }
        }

        // Build the template line(s). Single line for now — matches the
        // simple "$5K consulting" / "$1K subscription" cases. Multi-line
        // shapes ("$5K consulting and $1K hosting recurring") can be
        // added later without changing the schedule schema.
        const lineDescription = (description || 'Recurring invoice').trim().slice(0, 500);
        const templateLines = [
          { description: lineDescription, quantity: 1, rateCents: amountCents },
        ];

        const recurring = await db.abRecurringInvoice.create({
          data: {
            tenantId: ctx.tenantId,
            clientId: client.id,
            frequency: cadence,
            nextDue,
            templateLines: templateLines as never,
            totalCents: amountCents,
            daysToPay: 30,
            autoSend,
            currency: 'USD',
            status: 'active',
          },
        });

        await db.abEvent.create({
          data: {
            tenantId: ctx.tenantId,
            eventType: 'recurring_invoice.created',
            actor: 'agent',
            action: {
              recurringId: recurring.id,
              clientId: client.id,
              frequency: cadence,
              totalCents: amountCents,
              source: 'telegram',
            },
          },
        });

        return {
          stepId: step.id,
          success: true,
          data: {
            kind: 'recurring_created',
            recurringId: recurring.id,
            cadence,
            amountCents,
            clientName: client.name,
            firstRun: nextDue.toISOString(),
            description: lineDescription,
            autoSend,
          },
        };
      }

      // ─── Estimate flow (PR 7) ─────────────────────────────────────
      case 'estimate.create': {
        const rawText = (step.args.text as string | undefined) || '';
        let clientNameHint = step.args.clientNameHint as string | undefined;
        let amountCents = step.args.amountCents as number | undefined;
        let description = step.args.description as string | undefined;
        let validUntilHint = step.args.validUntilHint as string | undefined;

        // If slots are missing (regex source), re-parse via the dedicated
        // parser to fill them in. Mirrors how invoice.create_from_chat
        // and invoice.setup_recurring handle slot recovery.
        if (!clientNameHint || !amountCents) {
          const parsed = await parseCreateEstimateFromText(rawText);
          if (parsed) {
            clientNameHint = clientNameHint || parsed.clientNameHint;
            amountCents = amountCents || parsed.amountCents;
            description = description && description !== rawText ? description : parsed.description;
            validUntilHint = validUntilHint || parsed.validUntilHint;
          }
        }
        // The slot-source description was the raw text — replace with the
        // parsed snippet if we have one.
        if (description && description === rawText) {
          const reparsed = await parseCreateEstimateFromText(rawText);
          if (reparsed) description = reparsed.description;
        }

        if (!clientNameHint) {
          return {
            stepId: step.id,
            success: true,
            data: {
              kind: 'needs_clarify',
              question: 'Which client is the estimate for? Try "estimate Beta $4K for new website".',
            },
          };
        }
        if (!amountCents || amountCents <= 0) {
          return {
            stepId: step.id,
            success: true,
            data: {
              kind: 'needs_clarify',
              question: "What's the estimate amount? Try \"estimate Beta $4K for new website\".",
            },
          };
        }

        const resolution = await resolveClientByHint(ctx.tenantId, clientNameHint);
        const candidates = resolution.candidates;
        if (candidates.length === 0) {
          return {
            stepId: step.id,
            success: true,
            data: {
              kind: 'needs_clarify',
              question: `I don't have a client named "${clientNameHint}" on file. Add them first, then try again.`,
            },
          };
        }
        if (candidates.length > 1) {
          return {
            stepId: step.id,
            success: true,
            data: {
              kind: 'needs_clarify',
              question: `Which "${clientNameHint}" did you mean — ${candidates.slice(0, 6).map((c) => c.name).join(' or ')}?`,
            },
          };
        }
        const client = candidates[0];

        // Resolve validUntil. ISO date wins; "60 days" / "30 days" phrases
        // map to issued + N days; default 30 days.
        const now = new Date();
        let validUntil = new Date(now.getTime() + 30 * 86_400_000);
        if (validUntilHint) {
          const isoMatch = validUntilHint.match(/^(\d{4}-\d{2}-\d{2})$/);
          const daysMatch = validUntilHint.match(/^(\d{1,3})\s*days?$/i);
          if (isoMatch) {
            const d = new Date(isoMatch[1]);
            if (!isNaN(d.getTime())) validUntil = d;
          } else if (daysMatch) {
            const n = parseInt(daysMatch[1], 10);
            if (isFinite(n) && n > 0) validUntil = new Date(now.getTime() + n * 86_400_000);
          } else {
            const d = new Date(validUntilHint);
            if (!isNaN(d.getTime())) validUntil = d;
          }
        }

        const finalDescription = (description || 'Estimate').trim().slice(0, 500);

        const estimate = await db.$transaction(async (tx) => {
          const est = await tx.abEstimate.create({
            data: {
              tenantId: ctx.tenantId,
              clientId: client.id,
              amountCents,
              description: finalDescription,
              validUntil,
              status: 'pending',
            },
          });
          await tx.abEvent.create({
            data: {
              tenantId: ctx.tenantId,
              eventType: 'estimate.created',
              actor: 'agent',
              action: { estimateId: est.id, clientId: client.id, amountCents, source: 'telegram' },
            },
          });
          return est;
        });

        return {
          stepId: step.id,
          success: true,
          data: {
            kind: 'estimate_created',
            estimateId: estimate.id,
            estimateNumber: formatEstimateNumber(estimate),
            clientName: client.name,
            amountCents,
            description: finalDescription,
            validUntil: validUntil.toISOString(),
          },
        };
      }

      case 'estimate.convert': {
        const estimateNumberHint = step.args.estimateNumberHint as string | undefined;
        const estimateIdHint = step.args.estimateIdHint as string | undefined;
        const useMostRecent = step.args.useMostRecent as boolean | undefined;

        // Resolve which estimate.
        let estimate: { id: string; clientId: string; amountCents: number; description: string; status: string; convertedInvoiceId: string | null; createdAt: Date } | null = null;

        if (estimateIdHint) {
          estimate = await db.abEstimate.findFirst({
            where: { id: estimateIdHint, tenantId: ctx.tenantId },
          });
        }

        if (!estimate && estimateNumberHint) {
          // Match against the formatted number — last 4 of id (uppercase
          // hex w/o dashes) + year.
          const parts = parseEstimateNumberSuffix(estimateNumberHint);
          if (parts) {
            const candidates = await db.abEstimate.findMany({
              where: {
                tenantId: ctx.tenantId,
                createdAt: {
                  gte: new Date(Date.UTC(parts.year, 0, 1)),
                  lt: new Date(Date.UTC(parts.year + 1, 0, 1)),
                },
              },
              orderBy: { createdAt: 'desc' },
              take: 200,
            });
            estimate = candidates.find((e) => formatEstimateNumber(e) === `EST-${parts.year}-${parts.tail}`) || null;
          }
        }

        if (!estimate && useMostRecent) {
          // Prefer approved estimates first, then pending — those are the
          // ones a "convert" makes sense against.
          estimate = await db.abEstimate.findFirst({
            where: { tenantId: ctx.tenantId, status: { in: ['approved', 'pending'] } },
            orderBy: { createdAt: 'desc' },
          });
          if (!estimate) {
            // No live estimate — try most recent of any status.
            estimate = await db.abEstimate.findFirst({
              where: { tenantId: ctx.tenantId },
              orderBy: { createdAt: 'desc' },
            });
          }
        }

        if (!estimate) {
          return {
            stepId: step.id,
            success: true,
            data: {
              kind: 'needs_clarify',
              question: estimateNumberHint
                ? `I couldn't find estimate ${estimateNumberHint}.`
                : "I couldn't find that estimate. Try \"convert estimate EST-2026-0001 to invoice\".",
            },
          };
        }

        // Idempotent: already converted? Surface the existing invoice.
        if (estimate.status === 'converted' && estimate.convertedInvoiceId) {
          const inv = await db.abInvoice.findFirst({
            where: { id: estimate.convertedInvoiceId, tenantId: ctx.tenantId },
            include: { client: true, lines: true },
          });
          if (inv) {
            return {
              stepId: step.id,
              success: true,
              data: {
                kind: 'already_converted',
                estimateNumber: formatEstimateNumber(estimate),
                draftId: inv.id,
                invoiceNumber: inv.number,
                clientName: inv.client.name,
                clientEmail: inv.client.email,
                totalCents: inv.amountCents,
                currency: inv.currency,
                dueDate: inv.dueDate.toISOString(),
                issuedDate: inv.issuedDate.toISOString(),
                lines: inv.lines.map((l) => ({
                  description: l.description,
                  rateCents: l.rateCents,
                  quantity: l.quantity,
                  amountCents: l.amountCents,
                })),
              },
            };
          }
          // Estimate flagged converted but invoice missing — fall through
          // and create a fresh one.
        }

        if (estimate.status === 'declined' || estimate.status === 'expired') {
          return {
            stepId: step.id,
            success: true,
            data: {
              kind: 'needs_clarify',
              question: `Estimate ${formatEstimateNumber(estimate)} is ${estimate.status} — can't convert it.`,
            },
          };
        }

        // Auto-approve pending → approved as part of convert. Friction here
        // is bad; the user explicitly asked for the conversion.
        if (estimate.status === 'pending') {
          await db.$transaction(async (tx) => {
            await tx.abEstimate.update({
              where: { id: estimate!.id },
              data: { status: 'approved' },
            });
            await tx.abEvent.create({
              data: {
                tenantId: ctx.tenantId,
                eventType: 'estimate.approved',
                actor: 'user',
                action: { estimateId: estimate!.id, viaConvert: true, source: 'telegram' },
              },
            });
          });
        }

        const client = await db.abClient.findFirst({
          where: { id: estimate.clientId, tenantId: ctx.tenantId },
        });
        if (!client) {
          return {
            stepId: step.id,
            success: false,
            error: 'Estimate has no client on file',
          };
        }

        const draft = await createInvoiceDraft({
          tenantId: ctx.tenantId,
          client: { id: client.id, name: client.name, email: client.email },
          parsed: {
            lines: [
              { description: estimate.description, rateCents: estimate.amountCents, quantity: 1 },
            ],
            description: estimate.description,
            dueDateHint: 'net-30',
          },
          source: 'telegram',
        });

        await db.$transaction(async (tx) => {
          await tx.abEstimate.update({
            where: { id: estimate!.id },
            data: { status: 'converted', convertedInvoiceId: draft.draftId },
          });
          await tx.abEvent.create({
            data: {
              tenantId: ctx.tenantId,
              eventType: 'estimate.converted',
              actor: 'user',
              action: {
                estimateId: estimate!.id,
                invoiceId: draft.draftId,
                invoiceNumber: draft.invoiceNumber,
                amountCents: estimate!.amountCents,
                source: 'telegram',
              },
            },
          });
        });

        return {
          stepId: step.id,
          success: true,
          data: {
            kind: 'estimate_converted',
            estimateNumber: formatEstimateNumber(estimate),
            draftId: draft.draftId,
            invoiceNumber: draft.invoiceNumber,
            clientName: draft.clientName,
            clientEmail: draft.clientEmail,
            totalCents: draft.totalCents,
            currency: draft.currency,
            dueDate: draft.dueDate,
            issuedDate: draft.issuedDate,
            lines: draft.lines,
          },
        };
      }

      // ─── Tax package (PR 5) ───────────────────────────────────────
      case 'tax.generate_package': {
        const yearArg = step.args.year as number | undefined;
        // Default: previous calendar year (typical filing pattern).
        const year = typeof yearArg === 'number' && isFinite(yearArg) && yearArg > 2000
          ? yearArg
          : new Date().getUTCFullYear() - 1;

        // Resolve jurisdiction from tenant config (default 'us').
        const cfg = await db.abTenantConfig.findUnique({
          where: { userId: ctx.tenantId },
          select: { jurisdiction: true },
        });
        const jurisdiction: 'us' | 'ca' = cfg?.jurisdiction === 'ca' ? 'ca' : 'us';

        // Lazy-load to avoid pulling @react-pdf into tests / hot paths
        // that don't need it. The tax-package module itself further
        // lazy-loads the renderer in `generatePackage`.
        const { generatePackage } = await import('./agentbook-tax-package');
        const result = await generatePackage({
          tenantId: ctx.tenantId,
          year,
          jurisdiction,
        });

        return {
          stepId: step.id,
          success: true,
          data: {
            kind: 'tax_package',
            packageId: result.packageId,
            year,
            jurisdiction,
            pdfUrl: result.pdfUrl,
            receiptsZipUrl: result.receiptsZipUrl ?? null,
            csvUrls: result.csvUrls,
            summary: result.summary,
          },
        };
      }

      case 'budget.set': {
        // Resolve category by name (fuzzy match against AbAccount or
        // existing expense category names) and upsert the budget.
        const amountCents = step.args.amountCents as number | undefined;
        const categoryNameHint = step.args.categoryNameHint as string | undefined;
        const periodArg = (step.args.period as string | undefined) || 'monthly';
        const period = ['monthly', 'quarterly', 'annual'].includes(periodArg) ? periodArg : 'monthly';

        if (!amountCents || amountCents <= 0) {
          return {
            stepId: step.id,
            success: true,
            data: {
              kind: 'needs_clarify',
              question: 'How much should I cap that category at? Try "max $200 on meals each month".',
            },
          };
        }
        if (!categoryNameHint || !categoryNameHint.trim()) {
          return {
            stepId: step.id,
            success: true,
            data: {
              kind: 'needs_clarify',
              question: 'Which category should I cap? Try "max $200 on meals each month".',
            },
          };
        }

        // Fuzzy resolve against the chart of accounts. Exact-name match
        // wins; otherwise substring; if still nothing, accept the raw
        // hint as the budget name (so users can cap categories that
        // aren't in the chart yet).
        const term = categoryNameHint.trim();
        const termLower = term.toLowerCase();
        const accounts = await db.abAccount.findMany({
          where: { tenantId: ctx.tenantId, accountType: 'expense', isActive: true },
          select: { id: true, name: true },
        });
        const matched =
          accounts.find((a: { name: string }) => a.name.toLowerCase() === termLower)
          || accounts.find((a: { name: string }) => a.name.toLowerCase().includes(termLower))
          || accounts.find((a: { name: string }) => termLower.includes(a.name.toLowerCase()));

        const categoryId = matched ? matched.id : null;
        const categoryName = matched ? matched.name : term;

        // Prisma's compound-unique upsert with a nullable column rejects
        // `null` at runtime ("Argument `categoryId` must not be null"),
        // so fall back to findFirst + create-or-update.
        const existing = await db.abBudget.findFirst({
          where: {
            tenantId: ctx.tenantId,
            categoryId: categoryId ?? null,
            period,
          },
        });
        const budget = existing
          ? await db.abBudget.update({
              where: { id: existing.id },
              data: { amountCents, categoryName, alertPercent: 80 },
            })
          : await db.abBudget.create({
              data: {
                tenantId: ctx.tenantId,
                amountCents,
                categoryId,
                categoryName,
                period,
                alertPercent: 80,
              },
            });

        await db.abEvent.create({
          data: {
            tenantId: ctx.tenantId,
            eventType: 'budget.set',
            actor: 'agent',
            action: {
              budgetId: budget.id,
              categoryName,
              amountCents,
              period,
              source: 'telegram',
            },
          },
        });

        return {
          stepId: step.id,
          success: true,
          data: {
            kind: 'budget_set',
            budgetId: budget.id,
            categoryName,
            amountCents,
            period,
          },
        };
      }

      case 'cpa.invite': {
        // Owner-side: create a 90-day magic link for a CPA. Mirrors the
        // /agentbook-core/accountant/invite endpoint but inline so the
        // bot doesn't need a self-call. Returns the magic URL so the
        // evaluator can paste it into the reply.
        const email = (step.args.email as string | undefined)?.trim().toLowerCase();
        const role = (step.args.role as string | undefined) || 'cpa';
        if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          return {
            stepId: step.id,
            success: true,
            data: {
              kind: 'needs_clarify',
              question: 'What\'s your CPA\'s email? Try "invite my CPA jane@cpa.test".',
            },
          };
        }

        // Idempotency: reuse a still-valid invitation if one exists.
        const existing = await db.abTenantAccess.findFirst({
          where: {
            tenantId: ctx.tenantId,
            email,
            role,
            accessToken: { not: null },
            OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
          },
        });
        let accessToken: string;
        let accessId: string;
        let expiresAt: Date | null;
        if (existing && existing.accessToken) {
          accessToken = existing.accessToken;
          accessId = existing.id;
          expiresAt = existing.expiresAt;
        } else {
          const { generateAccessToken } = await import('./agentbook-cpa-token');
          accessToken = generateAccessToken();
          expiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);
          const created = await db.abTenantAccess.create({
            data: {
              tenantId: ctx.tenantId,
              userId: `cpa-${accessToken.slice(0, 12)}`,
              email,
              role,
              accessToken,
              expiresAt,
              invitedBy: 'telegram',
            },
          });
          accessId = created.id;
          // Mirror the HTTP route's audit trail.
          const { audit } = await import('./agentbook-audit');
          await audit({
            tenantId: ctx.tenantId,
            source: 'telegram',
            actor: 'bot',
            action: 'cpa.invite',
            entityType: 'AbTenantAccess',
            entityId: accessId,
            after: { email, role, expiresAt: expiresAt?.toISOString() ?? null },
          });
        }
        const base =
          process.env.APP_URL ||
          process.env.NEXT_PUBLIC_APP_URL ||
          'https://app.agentbook.test';
        const inviteUrl = `${base.replace(/\/$/, '')}/cpa/${accessToken}`;
        return {
          stepId: step.id,
          success: true,
          data: {
            kind: 'cpa_invited',
            accessId,
            email,
            role,
            inviteUrl,
            expiresAt,
            reused: !!existing,
          },
        };
      }

      // ─── Per-diem (PR 14) ────────────────────────────────────────
      // Records N daily AbExpense rows at the GSA M&IE rate (or
      // M&IE + lodging when the option is `lodging_and_mie`). For
      // CA tenants we short-circuit with a "not supported" message —
      // CRA doesn't recognise GSA per-diems for non-incorporated
      // freelancers, so we keep Maya safe.
      case 'per_diem.record': {
        const cityHint = (step.args.cityHint as string | undefined) || '';
        const days = step.args.days as number | undefined;
        const startDate = step.args.startDate as string | undefined;
        const endDate = step.args.endDate as string | undefined;
        const option = (step.args.option as 'mie_only' | 'lodging_and_mie' | undefined) || 'mie_only';

        // CA short-circuit: per-diem is a US-IRS construct.
        const cfg = await db.abTenantConfig.findUnique({
          where: { userId: ctx.tenantId },
          select: { jurisdiction: true },
        });
        const jurisdiction: 'us' | 'ca' = cfg?.jurisdiction === 'ca' ? 'ca' : 'us';
        if (jurisdiction === 'ca') {
          return {
            stepId: step.id,
            success: true,
            data: {
              kind: 'unsupported_jurisdiction',
              message:
                "Per-diem isn't a CA-supported method yet — use mileage + meals expenses instead. (Coming in a future release.)",
            },
          };
        }

        // Resolve date range. Precedence: explicit start+end > start+days >
        // days only (defaults to today onward) > nothing (1 day, today).
        const today = new Date();
        let start: Date | null = null;
        let end: Date | null = null;
        if (startDate) {
          const s = new Date(startDate + 'T00:00:00.000Z');
          if (!isNaN(s.getTime())) start = s;
        }
        if (endDate) {
          const e = new Date(endDate + 'T00:00:00.000Z');
          if (!isNaN(e.getTime())) end = e;
        }
        let dayCount = days && days > 0 ? days : 0;
        if (start && end && end >= start) {
          // Inclusive day count (May 5–7 = 3 days)
          const diffMs = end.getTime() - start.getTime();
          dayCount = Math.round(diffMs / (1000 * 60 * 60 * 24)) + 1;
        } else if (start && dayCount > 0) {
          end = new Date(start.getTime() + (dayCount - 1) * 24 * 60 * 60 * 1000);
        } else if (dayCount > 0 && !start) {
          start = today;
          end = new Date(today.getTime() + (dayCount - 1) * 24 * 60 * 60 * 1000);
        } else {
          // Fallback: single day, today.
          start = today;
          end = today;
          dayCount = 1;
        }
        if (dayCount <= 0 || dayCount > 90) {
          return {
            stepId: step.id,
            success: false,
            error: 'Per-diem trips are capped at 90 days. Tell me how many days.',
          };
        }

        const rate = lookupPerDiem(cityHint || '');
        if (!rate) {
          return {
            stepId: step.id,
            success: false,
            error: `Couldn't find a per-diem rate for "${cityHint}".`,
          };
        }
        const cityLabel = rate.city;

        // Try to find a Meals & Entertainment-ish category. If we
        // can't, the rows still book (just without categoryId — the
        // user can categorise later).
        const cats = ctx.categories;
        const mealsCat = cats.find((c) => /meal/i.test(c.name))
          || cats.find((c) => /travel/i.test(c.name))
          || null;
        const lodgingCat = option === 'lodging_and_mie'
          ? (cats.find((c) => /lodg|hotel/i.test(c.name))
              || cats.find((c) => /travel/i.test(c.name))
              || null)
          : null;

        // Create the rows in a single transaction.
        const created = await db.$transaction(async (tx) => {
          const rows: Array<{ id: string; amountCents: number; date: Date; description: string; kind: 'mie' | 'lodging' }> = [];
          for (let i = 0; i < dayCount; i += 1) {
            const day = new Date(start!.getTime() + i * 24 * 60 * 60 * 1000);
            const dateLabel = day.toISOString().slice(0, 10);
            const mieDescription = `Per-diem M&IE — ${cityLabel} ${dateLabel}`;
            const mieRow = await tx.abExpense.create({
              data: {
                tenantId: ctx.tenantId,
                amountCents: rate.mieCents,
                date: day,
                description: mieDescription,
                categoryId: mealsCat?.id || null,
                taxCategory: 'per_diem',
                isPersonal: false,
                isDeductible: true,
                status: 'confirmed',
                source: 'per_diem',
                currency: 'USD',
              },
            });
            rows.push({
              id: mieRow.id,
              amountCents: mieRow.amountCents,
              date: mieRow.date,
              description: mieRow.description || mieDescription,
              kind: 'mie',
            });
            if (option === 'lodging_and_mie') {
              const lodgingDescription = `Per-diem lodging — ${cityLabel} ${dateLabel}`;
              const lodgingRow = await tx.abExpense.create({
                data: {
                  tenantId: ctx.tenantId,
                  amountCents: rate.lodgingCents,
                  date: day,
                  description: lodgingDescription,
                  categoryId: lodgingCat?.id || null,
                  taxCategory: 'per_diem',
                  isPersonal: false,
                  isDeductible: true,
                  status: 'confirmed',
                  source: 'per_diem',
                  currency: 'USD',
                },
              });
              rows.push({
                id: lodgingRow.id,
                amountCents: lodgingRow.amountCents,
                date: lodgingRow.date,
                description: lodgingRow.description || lodgingDescription,
                kind: 'lodging',
              });
            }
          }
          await tx.abEvent.create({
            data: {
              tenantId: ctx.tenantId,
              eventType: 'per_diem.recorded',
              actor: 'agent',
              action: {
                cityHint,
                cityLabel,
                state: rate.state,
                days: dayCount,
                option,
                mieCents: rate.mieCents,
                lodgingCents: option === 'lodging_and_mie' ? rate.lodgingCents : null,
                rowCount: rows.length,
                source: 'telegram',
              },
            },
          });
          return rows;
        });

        const totalCents = created.reduce((s, r) => s + r.amountCents, 0);
        const usingFallback = rate.mieCents === CONUS_DEFAULT_MIE_CENTS && cityHint && cityLabel === 'CONUS Standard';
        return {
          stepId: step.id,
          success: true,
          data: {
            kind: 'per_diem_recorded',
            cityHint,
            city: cityLabel,
            state: rate.state,
            days: dayCount,
            option,
            mieCents: rate.mieCents,
            lodgingCents: option === 'lodging_and_mie' ? rate.lodgingCents : null,
            startDate: start!.toISOString().slice(0, 10),
            endDate: end!.toISOString().slice(0, 10),
            entries: created,
            totalCents,
            usingFallbackRate: !!usingFallback,
          },
        };
      }

      // ─── Home-office quarterly (PR 15) ─────────────────────────
      // User: "Q2 home office: utilities $400, internet $90, rent
      // $3000". Computes the deductible portion via square-footage
      // ratio (or US simplified $5/sqft × 300 cap ÷ 4) and creates
      // AbExpense rows tagged taxCategory='home_office' so the
      // tax-package aggregator can pick them up.
      case 'home_office.log': {
        const yearArg = step.args.year as number | undefined;
        const quarterArg = step.args.quarter as number | undefined;
        const utilitiesCents = (step.args.utilitiesCents as number | undefined) || 0;
        const internetCents = (step.args.internetCents as number | undefined) || 0;
        const rentInterestCents = (step.args.rentInterestCents as number | undefined) || 0;
        const insuranceCents = (step.args.insuranceCents as number | undefined) || 0;
        const otherCents = (step.args.otherCents as number | undefined) || 0;

        // Resolve quarter — default to the *current* calendar quarter
        // when unspecified (matches the UX of the cron prompt).
        const now = new Date();
        const month = now.getUTCMonth();
        const currentQuarter = (Math.floor(month / 3) + 1) as 1 | 2 | 3 | 4;
        const quarter = (quarterArg && quarterArg >= 1 && quarterArg <= 4) ? quarterArg : currentQuarter;
        const year = (yearArg && yearArg > 1900) ? yearArg : now.getUTCFullYear();

        const cfg = await db.abHomeOfficeConfig.findUnique({
          where: { tenantId: ctx.tenantId },
        });
        if (!cfg) {
          return {
            stepId: step.id,
            success: false,
            error: 'Set up your home-office config first (total + office sqft, or enable US simplified).',
          };
        }

        const ratio = cfg.ratio ?? computeRatio(cfg.totalSqft, cfg.officeSqft);
        const useSimplified = !!cfg.useUsSimplified;
        if (!useSimplified && (!ratio || ratio <= 0)) {
          return {
            stepId: step.id,
            success: false,
            error: "I don't have a square-footage ratio yet — set total + office sqft on your home-office page first.",
          };
        }

        const result = computeQuarterlyDeductible({
          mode: useSimplified ? 'us_simplified' : 'actual',
          ratio,
          officeSqft: cfg.officeSqft || undefined,
          utilitiesCents,
          internetCents,
          rentInterestCents,
          insuranceCents,
          otherCents,
        });

        const QUARTER_TO_MONTH: Record<number, number> = { 1: 0, 2: 3, 3: 6, 4: 9 };
        const anchor = new Date(Date.UTC(year, QUARTER_TO_MONTH[quarter], 1));
        const quarterLabel = `Q${quarter} ${year}`;

        if (result.deductibleCents <= 0) {
          return {
            stepId: step.id,
            success: true,
            data: {
              kind: 'home_office_recorded',
              year,
              quarter,
              mode: result.mode,
              ratio: useSimplified ? null : ratio,
              totalQuarterCents: result.totalQuarterCents,
              deductibleCents: 0,
              entries: [],
              skipped: true,
            },
          };
        }

        // Same per-component split logic as the HTTP route. Simplified
        // mode books one flat row; actual mode splits across the
        // non-zero components.
        const componentRows: Array<{ label: string; cents: number }> = [];
        if (useSimplified) {
          componentRows.push({
            label: `Home office — ${quarterLabel} (US simplified, ${cfg.officeSqft || 0} sqft)`,
            cents: result.deductibleCents,
          });
        } else {
          const components: Array<{ label: string; gross: number }> = [
            { label: 'utilities', gross: utilitiesCents },
            { label: 'internet', gross: internetCents },
            { label: 'rent/mortgage interest', gross: rentInterestCents },
            { label: 'insurance', gross: insuranceCents },
            { label: 'other', gross: otherCents },
          ].filter((c) => c.gross > 0);
          const totalGross = components.reduce((s, c) => s + c.gross, 0);
          let allocated = 0;
          components.forEach((c, i) => {
            let portion: number;
            if (i === components.length - 1) {
              portion = result.deductibleCents - allocated;
            } else {
              portion = Math.round((c.gross / totalGross) * result.deductibleCents);
              allocated += portion;
            }
            componentRows.push({
              label: `Home office — ${c.label} ${quarterLabel}`,
              cents: portion,
            });
          });
        }

        // Best-effort category lookup — same heuristic as the route.
        const homeOfficeCat = ctx.categories.find((c) => /home\s*office/i.test(c.name))
          || ctx.categories.find((c) => /utilit/i.test(c.name))
          || null;

        const created = await db.$transaction(async (tx) => {
          const rows: Array<{ id: string; amountCents: number; description: string }> = [];
          for (const row of componentRows) {
            if (row.cents <= 0) continue;
            const r = await tx.abExpense.create({
              data: {
                tenantId: ctx.tenantId,
                amountCents: row.cents,
                date: anchor,
                description: row.label,
                categoryId: homeOfficeCat?.id || null,
                taxCategory: 'home_office',
                isPersonal: false,
                isDeductible: true,
                status: 'confirmed',
                source: 'home_office',
                currency: 'USD',
              },
            });
            rows.push({
              id: r.id,
              amountCents: r.amountCents,
              description: r.description || row.label,
            });
          }
          await tx.abEvent.create({
            data: {
              tenantId: ctx.tenantId,
              eventType: 'home_office.quarter_posted',
              actor: 'agent',
              action: {
                year,
                quarter,
                mode: result.mode,
                ratio: useSimplified ? null : ratio,
                totalQuarterCents: result.totalQuarterCents,
                deductibleCents: result.deductibleCents,
                rowCount: rows.length,
                source: 'telegram',
              },
            },
          });
          return rows;
        });

        return {
          stepId: step.id,
          success: true,
          data: {
            kind: 'home_office_recorded',
            year,
            quarter,
            mode: result.mode,
            ratio: useSimplified ? null : ratio,
            totalQuarterCents: result.totalQuarterCents,
            deductibleCents: result.deductibleCents,
            entries: created,
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

  // CPA invite (PR 11): build the reply inline so the user sees the
  // magic link directly. Owner-side flow runs on Telegram so the
  // webhook adapter doesn't need to add keyboards here.
  if (intent.intent === 'invite_cpa') {
    const r = results[0];
    const data = r?.data as
      | {
          kind: string;
          email?: string;
          inviteUrl?: string;
          reused?: boolean;
          question?: string;
        }
      | undefined;
    if (!r?.success || !data) {
      return {
        reply: r?.error || 'Couldn\'t generate the invite — please try again.',
        parseMode: undefined,
        learned,
        delegatedToBrain: false,
        needsKeyboard: false,
      };
    }
    if (data.kind === 'needs_clarify') {
      return {
        reply: `🤔 ${data.question || 'What\'s your CPA\'s email?'}`,
        parseMode: undefined,
        learned,
        delegatedToBrain: false,
        needsKeyboard: false,
      };
    }
    const reusedNote = data.reused ? '\n<i>(reusing the link I sent earlier — same link, still valid)</i>' : '';
    return {
      reply:
        `📒 Invited <b>${escHtml(data.email || '')}</b>. ` +
        `Send them this magic link — read-only access, expires in 90 days:\n\n` +
        `<code>${escHtml(data.inviteUrl || '')}</code>${reusedNote}`,
      parseMode: 'HTML',
      learned,
      delegatedToBrain: false,
      needsKeyboard: false,
    };
  }

  // Timer + invoice-from-timer (PR 2) + record_mileage (PR 4) +
  // generate_tax_package (PR 5) + setup_recurring_invoice (PR 6):
  // same handoff pattern as create_invoice_from_chat — the webhook
  // renders rich, keyboarded replies.
  if (
    intent.intent === 'start_timer' ||
    intent.intent === 'stop_timer' ||
    intent.intent === 'timer_status' ||
    intent.intent === 'invoice_from_timer' ||
    intent.intent === 'record_mileage' ||
    intent.intent === 'generate_tax_package' ||
    intent.intent === 'setup_recurring_invoice' ||
    intent.intent === 'create_estimate' ||
    intent.intent === 'convert_estimate' ||
    intent.intent === 'set_budget' ||
    intent.intent === 'record_per_diem' ||
    intent.intent === 'log_home_office'
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
