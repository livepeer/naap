/**
 * Natural-language invoice parser.
 *
 * Two paths:
 *   1. Gemini (when GEMINI_API_KEY is set) — JSON-only structured output.
 *   2. Regex fallback — handles the common "invoice <client> $<amt> for
 *      <description>" shape, including K suffix and multi-line totals
 *      separated by commas / "and".
 *
 * Returns null when the message clearly isn't an invoice request, OR when
 * neither path can pin down a client + amount. The webhook adapter then
 * asks the user to clarify.
 */

import 'server-only';

export interface ParsedInvoiceLine {
  description: string;
  rateCents: number;
  quantity: number;
}

export interface ParsedInvoiceDraft {
  clientNameHint: string;     // raw text the user said, before resolution
  amountCents: number;        // total when single-line; sum across lines otherwise
  lines: ParsedInvoiceLine[];
  description?: string;
  dueDateHint?: string;       // ISO date or relative ("net-30")
  currencyHint?: string;      // 'USD' default
  confidence: number;         // 0-1
}

const INVOICE_TRIGGER = /^(?:invoice|bill|send.+invoice|create.+invoice)\s+/i;

/** Multiply by 1000 if the user said "5K" / "5k". */
function dollarsToCents(raw: string, kSuffix: boolean): number {
  const n = parseFloat(raw.replace(/,/g, ''));
  if (!isFinite(n) || n <= 0) return 0;
  return Math.round((kSuffix ? n * 1000 : n) * 100);
}

/**
 * Parse one of:
 *   • "$5K consulting"
 *   • "$1,000 hosting"
 *   • "$5000 for July consulting"
 *   • "5K consulting"
 *
 * Returns null if no usable amount.
 */
function parseSegment(seg: string): ParsedInvoiceLine | null {
  const trimmed = seg.trim().replace(/^(?:and|,)\s*/i, '');
  // amount + optional K suffix + optional "for" + description
  const m = trimmed.match(/^\$?\s*([\d,]+(?:\.\d+)?)\s*(K|k)?\s+(?:for\s+)?(.+?)$/);
  if (!m) return null;
  const cents = dollarsToCents(m[1], !!m[2]);
  if (cents <= 0) return null;
  const description = m[3].trim().replace(/[.!?]+$/, '');
  if (!description) return null;
  return { description, rateCents: cents, quantity: 1 };
}

/**
 * Regex parser. Returns null if the message doesn't look like an invoice
 * request, or if we can't pin down both a client + at least one line.
 */
export function parseInvoiceWithRegex(text: string): ParsedInvoiceDraft | null {
  if (!INVOICE_TRIGGER.test(text)) return null;

  // Strip the leading verb so we can read the client name.
  const stripped = text.replace(/^(?:please\s+)?(?:can you\s+)?(?:invoice|bill|send(?:\s+\w+)?\s+invoice(?:\s+for)?|create(?:\s+an?)?\s+invoice(?:\s+for)?)\s+/i, '').trim();

  // The client name runs from the start of `stripped` up to the first
  // dollar amount (or the word "for" before an amount). It can include
  // ampersands, apostrophes, hyphens, spaces.
  const clientMatch = stripped.match(/^([A-Z][\w&'\- .]*?)(?=\s+\$|\s+\d|\s+for\s+\$|\s+for\s+\d|$)/);
  if (!clientMatch) return null;
  const clientNameHint = clientMatch[1].trim().replace(/\s+/g, ' ');
  if (!clientNameHint || clientNameHint.length < 2) return null;

  // Everything after the client name — split into segments by commas
  // or "and" so we can parse multiple line items.
  const tail = stripped.slice(clientMatch[0].length).trim();
  if (!tail) return null;

  // Split on commas/and only when they look like line-item boundaries —
  // i.e. followed by whitespace + an optional `$` + a digit. That keeps
  // thousand-separator commas inside `$2,500` intact.
  const segments = tail.split(/\s*(?:,|\band\b)\s+(?=\$?\d)/i).filter(Boolean);
  const lines: ParsedInvoiceLine[] = [];
  for (const seg of segments) {
    const line = parseSegment(seg);
    if (line) lines.push(line);
  }

  if (lines.length === 0) return null;

  const amountCents = lines.reduce((sum, l) => sum + l.rateCents * l.quantity, 0);
  const description = lines.length === 1 ? lines[0].description : lines.map((l) => l.description).join(', ');

  return {
    clientNameHint,
    amountCents,
    lines,
    description,
    dueDateHint: 'net-30',
    currencyHint: 'USD',
    confidence: lines.length === 1 ? 0.85 : 0.8,
  };
}

interface GeminiInvoiceResponse {
  client_name?: string;
  amount_cents?: number;
  lines?: Array<{ description?: string; rate_cents?: number; quantity?: number }>;
  description?: string;
  due_date?: string;
  currency?: string;
  confidence?: number;
}

/**
 * Ask Gemini to extract structured invoice fields. Returns null if the
 * key is unset, the call errored, or the response couldn't be parsed.
 */
async function parseInvoiceWithGemini(text: string): Promise<ParsedInvoiceDraft | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;

  const model = process.env.GEMINI_MODEL_FAST || 'gemini-2.0-flash';
  // The API key is passed as a query param per Google's generative-language
  // SDK convention. Don't move it to a header — the v1beta endpoint only
  // accepts it on the URL.
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const systemPrompt = `You extract invoice details from a freelancer's casual Telegram message.

EXAMPLES
   "invoice Acme $5K for July consulting" →
     {"client_name": "Acme", "amount_cents": 500000,
      "lines": [{"description": "July consulting", "rate_cents": 500000, "quantity": 1}],
      "due_date": "net-30", "currency": "USD", "confidence": 0.9}

   "invoice Acme $5K consulting, $1K hosting" →
     {"client_name": "Acme", "amount_cents": 600000,
      "lines": [
        {"description": "consulting", "rate_cents": 500000, "quantity": 1},
        {"description": "hosting", "rate_cents": 100000, "quantity": 1}
      ],
      "due_date": "net-30", "currency": "USD", "confidence": 0.9}

   "bill TechCorp 3000 for web design due July 20" →
     {"client_name": "TechCorp", "amount_cents": 300000,
      "lines": [{"description": "web design", "rate_cents": 300000, "quantity": 1}],
      "due_date": "2026-07-20", "currency": "USD", "confidence": 0.85}

RULES
   • amount_cents is the TOTAL across all lines (sum of rate_cents * quantity).
   • If the user said "$5K", that's $5,000 → 500_000 cents. "$5,000.50" → 500_050.
   • due_date: ISO date if explicit ("July 20" → 2026-07-20). Otherwise "net-30".
   • currency: USD default.
   • Confidence: 0.9+ if explicit client + amount + description; 0.7 if vague; below 0.5 = not actually an invoice request.

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
        generationConfig: { maxOutputTokens: 400, temperature: 0.1 },
      }),
    });
    if (!res.ok) {
      console.warn(`[invoice-parser] Gemini call failed: HTTP ${res.status}`);
      return null;
    }
    const data = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    raw = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  } catch (err) {
    console.warn('[invoice-parser] Gemini call failed:', (err as Error)?.message || err);
    return null;
  }

  try {
    const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const json = cleaned.match(/\{[\s\S]*\}/)?.[0] || cleaned;
    const parsed = JSON.parse(json) as GeminiInvoiceResponse;
    if (!parsed.client_name || !parsed.amount_cents || !parsed.lines || parsed.lines.length === 0) {
      return null;
    }
    if ((parsed.confidence ?? 0) < 0.5) return null;

    const lines: ParsedInvoiceLine[] = parsed.lines
      .map((l) => ({
        description: l.description?.trim() || '',
        rateCents: typeof l.rate_cents === 'number' ? l.rate_cents : 0,
        quantity: typeof l.quantity === 'number' && l.quantity > 0 ? l.quantity : 1,
      }))
      .filter((l) => l.description && l.rateCents > 0);
    if (lines.length === 0) return null;

    return {
      clientNameHint: parsed.client_name.trim(),
      amountCents: parsed.amount_cents,
      lines,
      description: parsed.description?.trim() || (lines.length === 1 ? lines[0].description : lines.map((l) => l.description).join(', ')),
      dueDateHint: parsed.due_date || 'net-30',
      currencyHint: parsed.currency || 'USD',
      confidence: parsed.confidence ?? 0.8,
    };
  } catch (err) {
    console.warn('[invoice-parser] Gemini response parse failed:', (err as Error)?.message || err);
    return null;
  }
}

/**
 * Top-level parser. Tries Gemini first (when configured) and falls back
 * to regex. Returns null on parse failure.
 */
export async function parseInvoiceFromText(text: string): Promise<ParsedInvoiceDraft | null> {
  if (!text || typeof text !== 'string') return null;
  const trimmed = text.trim();
  if (!trimmed) return null;

  const llm = await parseInvoiceWithGemini(trimmed);
  if (llm) return llm;
  return parseInvoiceWithRegex(trimmed);
}
