/**
 * Natural-language recurring-invoice parser.
 *
 * Two paths:
 *   1. Gemini (when GEMINI_API_KEY is set) — JSON-only structured output.
 *   2. Regex fallback — handles "every month invoice TechCorp $5K consulting
 *      on the 1st", "set up monthly $1K subscription for Acme", "schedule a
 *      quarterly invoice for Beta $3K".
 *
 * Returns null when the message clearly isn't a recurring-invoice request,
 * OR when neither path can pin down a cadence + client + amount. The
 * webhook adapter then asks the user to clarify.
 *
 * Mirrors the shape of `agentbook-invoice-parser.ts` (PR 1) so the bot
 * agent can reuse the same plumbing.
 */

import 'server-only';

export type Cadence = 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'annual';

export interface ParsedRecurringDraft {
  cadence: Cadence;
  amountCents: number;
  clientNameHint: string;
  description?: string;
  dayOfMonth?: number;
  confidence: number;
}

const CADENCE_TRIGGER =
  /\b(?:every|each|monthly|weekly|quarterly|biweekly|bi-weekly|annually|annual|yearly|recurring)\b/i;
const SETUP_TRIGGER =
  /^(?:please\s+|can you\s+)?(?:set\s+up|schedule|create)\s+(?:an?\s+)?(?:weekly|biweekly|bi-weekly|monthly|quarterly|annual|yearly|recurring)\s+(?:recurring\s+)?invoice/i;

/** Multiply by 1000 if the user said "5K" / "5k". */
function dollarsToCents(raw: string, kSuffix: boolean): number {
  const n = parseFloat(raw.replace(/,/g, ''));
  if (!isFinite(n) || n <= 0) return 0;
  return Math.round((kSuffix ? n * 1000 : n) * 100);
}

/** Map a cadence keyword (any of "every month", "monthly", "biweekly", etc.) to the canonical token. */
function detectCadence(text: string): Cadence | null {
  const lower = text.toLowerCase();
  if (/\b(?:bi-?weekly|every\s+two\s+weeks|every\s+other\s+week)\b/.test(lower)) return 'biweekly';
  if (/\b(?:weekly|every\s+week|each\s+week)\b/.test(lower)) return 'weekly';
  if (/\b(?:monthly|every\s+month|each\s+month)\b/.test(lower)) return 'monthly';
  if (/\b(?:quarterly|every\s+quarter|each\s+quarter)\b/.test(lower)) return 'quarterly';
  if (/\b(?:annually|annual|yearly|every\s+year|each\s+year)\b/.test(lower)) return 'annual';
  return null;
}

/** Extract a $ amount + optional K suffix from the text; returns the matched amount in cents (or 0 if absent / invalid). */
function extractAmount(text: string): number {
  // Matches: $5K, $5,000, $5000.50, 5K, 1,000.00. Filter to the first
  // positive match so "drove 23 km" / "every 2 weeks" doesn't get picked up.
  const re = /\$\s*([\d,]+(?:\.\d+)?)\s*(K|k)?\b|\b([\d,]+(?:\.\d+)?)\s*(K|k)\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const raw = m[1] ?? m[3];
    const k = !!(m[2] || m[4]);
    if (!raw) continue;
    const cents = dollarsToCents(raw, k);
    if (cents > 0) return cents;
  }
  return 0;
}

/**
 * Pull a capitalised client name from after `for` / `invoice` or as the
 * first capitalised token sequence. Mirrors PR 1's invoice parser shape.
 */
function extractClient(text: string): string | null {
  // Pattern A: "...invoice <Client> $..." — client between "invoice" and "$"
  const a = text.match(/\binvoice\s+([A-Z][\w&'\- .]*?)(?=\s+\$|\s+\d|\s+for\s+|$)/);
  if (a) {
    const name = a[1].trim().replace(/\s+/g, ' ');
    if (name && name.length >= 2) return name;
  }

  // Pattern B: "...for <Client>$<amt>..." — client after "for" up to next $
  const b = text.match(/\bfor\s+([A-Z][\w&'\- .]*?)(?=\s+\$|\s+\d|\s+for\s+|$)/);
  if (b) {
    const name = b[1].trim().replace(/\s+/g, ' ');
    if (name && name.length >= 2) return name;
  }
  return null;
}

/** Pull a "<n>th" / "<n>st" / "on the <n>" day-of-month hint. */
function extractDayOfMonth(text: string): number | undefined {
  const m = text.match(/\bon the (\d{1,2})(?:st|nd|rd|th)?\b/i);
  if (!m) return undefined;
  const n = parseInt(m[1], 10);
  if (!isFinite(n) || n < 1 || n > 31) return undefined;
  return n;
}

/** Extract a freeform description — the noun after the amount or "for". */
function extractDescription(text: string): string | undefined {
  // "$5K consulting" / "$5K for July consulting" → "consulting" / "July consulting"
  const m = text.match(/\$?\s*[\d,]+(?:\.\d+)?\s*(?:K|k)?\s+(?:for\s+)?([A-Za-z][\w &'\-]+?)(?=\s+on\s+the\b|\s+every\b|\s+each\b|[.!?]?\s*$)/);
  if (m) {
    const desc = m[1].trim().replace(/\s+/g, ' ');
    if (desc && desc.length >= 2) return desc;
  }
  return undefined;
}

/**
 * Regex parser. Returns null if the message doesn't look like a recurring
 * invoice request, or if we can't pin down cadence + client + amount.
 */
export function parseRecurringWithRegex(text: string): ParsedRecurringDraft | null {
  if (!text || typeof text !== 'string') return null;
  const trimmed = text.trim();
  if (!trimmed) return null;

  if (!CADENCE_TRIGGER.test(trimmed) && !SETUP_TRIGGER.test(trimmed)) return null;

  const cadence = detectCadence(trimmed);
  if (!cadence) return null;

  const amountCents = extractAmount(trimmed);
  if (amountCents <= 0) return null;

  const clientNameHint = extractClient(trimmed);
  if (!clientNameHint) return null;

  const dayOfMonth = extractDayOfMonth(trimmed);
  const description = extractDescription(trimmed);

  return {
    cadence,
    amountCents,
    clientNameHint,
    description,
    dayOfMonth,
    confidence: 0.8,
  };
}

interface GeminiRecurringResponse {
  cadence?: string;
  amount_cents?: number;
  client_name?: string;
  description?: string;
  day_of_month?: number;
  confidence?: number;
}

/**
 * Ask Gemini to extract structured recurring-invoice fields. Returns null
 * if the key is unset, the call errored, or the response couldn't be
 * parsed.
 */
async function parseRecurringWithGemini(text: string): Promise<ParsedRecurringDraft | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;

  const model = process.env.GEMINI_MODEL_FAST || 'gemini-2.0-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const systemPrompt = `You extract recurring-invoice schedule details from a freelancer's casual Telegram message.

EXAMPLES
   "every month invoice TechCorp $5K consulting on the 1st" →
     {"cadence": "monthly", "client_name": "TechCorp", "amount_cents": 500000,
      "description": "consulting", "day_of_month": 1, "confidence": 0.9}

   "set up monthly $1K subscription for Acme" →
     {"cadence": "monthly", "client_name": "Acme", "amount_cents": 100000,
      "description": "subscription", "confidence": 0.9}

   "schedule a quarterly invoice for Beta $3K" →
     {"cadence": "quarterly", "client_name": "Beta", "amount_cents": 300000,
      "confidence": 0.85}

RULES
   • cadence MUST be one of: weekly, biweekly, monthly, quarterly, annual.
   • amount_cents is the per-period total. "$5K" → 500000 cents.
   • day_of_month: optional 1-31 if the user said "on the Nth".
   • Confidence: 0.9+ if explicit cadence + client + amount; 0.7 if vague; below 0.5 = not actually a recurring-invoice request.

OUTPUT
Respond with ONLY a JSON object — no preamble, no code fences.`;

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
    if (!res.ok) {
      console.warn(`[recurring-parser] Gemini call failed: HTTP ${res.status}`);
      return null;
    }
    const data = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    raw = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  } catch (err) {
    console.warn('[recurring-parser] Gemini call failed:', (err as Error)?.message || err);
    return null;
  }

  try {
    const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const json = cleaned.match(/\{[\s\S]*\}/)?.[0] || cleaned;
    const parsed = JSON.parse(json) as GeminiRecurringResponse;
    const cad = (parsed.cadence || '').toLowerCase();
    const validCads: Cadence[] = ['weekly', 'biweekly', 'monthly', 'quarterly', 'annual'];
    if (!validCads.includes(cad as Cadence)) return null;
    if (!parsed.client_name || !parsed.amount_cents || parsed.amount_cents <= 0) return null;
    if ((parsed.confidence ?? 0) < 0.5) return null;

    return {
      cadence: cad as Cadence,
      amountCents: parsed.amount_cents,
      clientNameHint: parsed.client_name.trim(),
      description: parsed.description?.trim(),
      dayOfMonth:
        typeof parsed.day_of_month === 'number' && parsed.day_of_month >= 1 && parsed.day_of_month <= 31
          ? parsed.day_of_month
          : undefined,
      confidence: parsed.confidence ?? 0.8,
    };
  } catch (err) {
    console.warn('[recurring-parser] Gemini response parse failed:', (err as Error)?.message || err);
    return null;
  }
}

/**
 * Top-level parser. Tries Gemini first (when configured) and falls back
 * to regex. Returns null on parse failure.
 */
export async function parseRecurringFromText(text: string): Promise<ParsedRecurringDraft | null> {
  if (!text || typeof text !== 'string') return null;
  const trimmed = text.trim();
  if (!trimmed) return null;

  const llm = await parseRecurringWithGemini(trimmed);
  if (llm) return llm;
  return parseRecurringWithRegex(trimmed);
}
