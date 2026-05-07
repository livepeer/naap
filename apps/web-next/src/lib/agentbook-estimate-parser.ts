/**
 * Natural-language estimate parsers (PR 7).
 *
 * Two intents:
 *   • CREATE: "estimate Beta $4K for new website"
 *   • CONVERT: "convert estimate EST-2026-003 to invoice"
 *
 * Both have a regex fallback (used here in tests) and a Gemini-first path
 * (only fires when GEMINI_API_KEY is set). Mirrors the shape of the
 * invoice and recurring parsers so the bot agent can reuse the same
 * plumbing.
 */

import 'server-only';

// ─── Types ────────────────────────────────────────────────────────────────

export interface ParsedEstimateDraft {
  clientNameHint: string;
  amountCents: number;
  description: string;
  /** Free-text hint — ISO date ("2026-06-30") OR phrase ("60 days").
   *  The executor resolves it; default is 30 days from issue. */
  validUntilHint?: string;
  confidence: number;
}

export interface ParsedConvertEstimate {
  estimateNumberHint?: string;
  estimateIdHint?: string;
  useMostRecent?: boolean;
  confidence: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────

const ESTIMATE_TRIGGER = /^(?:please\s+|can you\s+)?(?:estimate|quote|estimate for|quote for)\s+/i;
const CONVERT_TRIGGER = /\b(?:convert|turn|make|change)\b.*\b(?:estimate|EST-)/i;

function dollarsToCents(raw: string, kSuffix: boolean): number {
  const n = parseFloat(raw.replace(/,/g, ''));
  if (!isFinite(n) || n <= 0) return 0;
  return Math.round((kSuffix ? n * 1000 : n) * 100);
}

function extractValidUntil(text: string): string | undefined {
  // ISO date hint: "valid until 2026-06-30"
  const iso = text.match(/\bvalid(?:\s+until)?\s+(\d{4}-\d{2}-\d{2})\b/i);
  if (iso) return iso[1];

  // "valid 60 days" / "valid for 60 days" / "good for 30 days"
  const days = text.match(/\b(?:valid|good)(?:\s+for)?\s+(\d{1,3}\s*days?)\b/i);
  if (days) return days[1].toLowerCase().replace(/\s+/g, ' ');

  // "until June 30"
  const monthDay = text.match(/\buntil\s+([A-Za-z]+\s+\d{1,2}(?:,?\s+\d{4})?)/);
  if (monthDay) return monthDay[1];

  return undefined;
}

// ─── Create-estimate parser ───────────────────────────────────────────────

/**
 * Regex parser for "estimate Beta $4K for new website".
 * Returns null if the message doesn't look like an estimate request.
 */
export function parseCreateEstimateWithRegex(text: string): ParsedEstimateDraft | null {
  if (!text || typeof text !== 'string') return null;
  const trimmed = text.trim();
  if (!trimmed) return null;

  if (!ESTIMATE_TRIGGER.test(trimmed)) return null;
  // Don't steal the invoice trigger — "invoice" alone is PR 1.
  if (/^(?:please\s+|can you\s+)?(?:invoice|bill)\s+/i.test(trimmed)) return null;

  // Strip the leading verb so we can read the client name.
  const stripped = trimmed.replace(
    /^(?:please\s+)?(?:can you\s+)?(?:estimate(?:\s+for)?|quote(?:\s+for)?)\s+/i,
    '',
  ).trim();

  // Client name: everything before the first $ / digit / "for".
  const clientMatch = stripped.match(/^([A-Z][\w&'\- .]*?)(?=\s+\$|\s+\d|\s+for\s+\$|\s+for\s+\d|$)/);
  if (!clientMatch) return null;
  const clientNameHint = clientMatch[1].trim().replace(/\s+/g, ' ');
  if (!clientNameHint || clientNameHint.length < 2) return null;

  const tail = stripped.slice(clientMatch[0].length).trim();
  if (!tail) return null;

  // Amount + optional K suffix + optional "for" + description.
  // Allow trailing free text we'll trim out (validUntil etc.).
  const m = tail.match(/^\$?\s*([\d,]+(?:\.\d+)?)\s*(K|k)?\s+(?:for\s+)?(.+?)$/);
  if (!m) return null;
  const cents = dollarsToCents(m[1], !!m[2]);
  if (cents <= 0) return null;

  // Strip trailing valid-until phrase from description.
  let description = m[3]
    .replace(/[.!?]+$/, '')
    .replace(/[, ]+(?:valid|good)(?:\s+for)?\s+\d{1,3}\s*days?\b.*$/i, '')
    .replace(/[, ]+valid(?:\s+until)?\s+\d{4}-\d{2}-\d{2}\b.*$/i, '')
    .replace(/\s+until\s+[A-Za-z]+\s+\d{1,2}(?:,?\s+\d{4})?.*$/i, '')
    .trim();
  if (!description) return null;

  const validUntilHint = extractValidUntil(trimmed);

  return {
    clientNameHint,
    amountCents: cents,
    description,
    validUntilHint,
    confidence: 0.85,
  };
}

interface GeminiCreateEstimateResponse {
  client_name?: string;
  amount_cents?: number;
  description?: string;
  valid_until?: string;
  confidence?: number;
}

async function parseCreateEstimateWithGemini(text: string): Promise<ParsedEstimateDraft | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;

  const model = process.env.GEMINI_MODEL_FAST || 'gemini-2.0-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const systemPrompt = `You extract estimate (quote) details from a freelancer's casual Telegram message.

EXAMPLES
   "estimate Beta $4K for new website" →
     {"client_name": "Beta", "amount_cents": 400000, "description": "new website", "confidence": 0.9}

   "quote Acme Corp $10K for redesign valid 60 days" →
     {"client_name": "Acme Corp", "amount_cents": 1000000, "description": "redesign", "valid_until": "60 days", "confidence": 0.9}

RULES
   • amount_cents is the total, in cents. "$4K" → 400000.
   • valid_until is OPTIONAL — pass an ISO date ("2026-06-30") or a phrase ("60 days") if mentioned. Otherwise omit.
   • Do NOT pick this for "invoice X $Y" — that's the invoice intent.
   • Confidence: 0.9+ if explicit client + amount + description; below 0.5 = not an estimate.

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
    if (!res.ok) return null;
    const data = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    raw = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  } catch {
    return null;
  }

  try {
    const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const json = cleaned.match(/\{[\s\S]*\}/)?.[0] || cleaned;
    const parsed = JSON.parse(json) as GeminiCreateEstimateResponse;
    if (!parsed.client_name || !parsed.amount_cents || parsed.amount_cents <= 0) return null;
    if ((parsed.confidence ?? 0) < 0.5) return null;
    return {
      clientNameHint: parsed.client_name.trim(),
      amountCents: parsed.amount_cents,
      description: (parsed.description || '').trim() || 'Estimate',
      validUntilHint: parsed.valid_until?.trim() || undefined,
      confidence: parsed.confidence ?? 0.8,
    };
  } catch {
    return null;
  }
}

export async function parseCreateEstimateFromText(text: string): Promise<ParsedEstimateDraft | null> {
  if (!text || typeof text !== 'string') return null;
  const trimmed = text.trim();
  if (!trimmed) return null;

  const llm = await parseCreateEstimateWithGemini(trimmed);
  if (llm) return llm;
  return parseCreateEstimateWithRegex(trimmed);
}

// ─── Convert-estimate parser ──────────────────────────────────────────────

const EST_NUMBER_RE = /\bEST-\d{4}-[A-Z0-9]{3,8}\b/i;

/**
 * Regex parser for "convert estimate EST-2026-003 to invoice" / "make EST-…
 * an invoice" / "convert the most recent estimate to invoice".
 */
export function parseConvertEstimateWithRegex(text: string): ParsedConvertEstimate | null {
  if (!text || typeof text !== 'string') return null;
  const trimmed = text.trim();
  if (!trimmed) return null;

  if (!CONVERT_TRIGGER.test(trimmed) && !EST_NUMBER_RE.test(trimmed)) return null;

  // Must mention "invoice" somewhere as the conversion target — otherwise
  // we don't own this turn.
  if (!/\binvoice\b/i.test(trimmed)) return null;

  const numMatch = trimmed.match(EST_NUMBER_RE);
  if (numMatch) {
    return {
      estimateNumberHint: numMatch[0].toUpperCase(),
      confidence: 0.9,
    };
  }

  // "convert the most recent estimate to invoice"
  if (/\b(?:most\s+recent|latest|last)\s+estimate\b/i.test(trimmed)) {
    return { useMostRecent: true, confidence: 0.85 };
  }

  return null;
}

interface GeminiConvertResponse {
  estimate_number?: string;
  use_most_recent?: boolean;
  confidence?: number;
}

async function parseConvertEstimateWithGemini(text: string): Promise<ParsedConvertEstimate | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;

  const model = process.env.GEMINI_MODEL_FAST || 'gemini-2.0-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const systemPrompt = `You decide whether a freelancer's Telegram message is asking to CONVERT an estimate (quote) into an invoice.

EXAMPLES
   "convert estimate EST-2026-003 to invoice" → {"estimate_number": "EST-2026-003", "confidence": 0.95}
   "make EST-2026-AB12 an invoice" → {"estimate_number": "EST-2026-AB12", "confidence": 0.95}
   "convert the most recent estimate to invoice" → {"use_most_recent": true, "confidence": 0.9}
   "invoice Acme $5K" → {"confidence": 0.0}

RULES
   • estimate_number must look like EST-YYYY-XXXX if present.
   • Use use_most_recent=true if the user said "most recent" / "latest" / "last".
   • Confidence below 0.5 = not a convert request.

OUTPUT
Respond with ONLY a JSON object.`;

  let raw: string;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: 'user', parts: [{ text: `User said: "${text}"` }] }],
        generationConfig: { maxOutputTokens: 200, temperature: 0.1 },
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
    const parsed = JSON.parse(json) as GeminiConvertResponse;
    if ((parsed.confidence ?? 0) < 0.5) return null;
    if (parsed.estimate_number) {
      return { estimateNumberHint: parsed.estimate_number.toUpperCase(), confidence: parsed.confidence ?? 0.8 };
    }
    if (parsed.use_most_recent) {
      return { useMostRecent: true, confidence: parsed.confidence ?? 0.8 };
    }
    return null;
  } catch {
    return null;
  }
}

export async function parseConvertEstimateFromText(text: string): Promise<ParsedConvertEstimate | null> {
  if (!text || typeof text !== 'string') return null;
  const trimmed = text.trim();
  if (!trimmed) return null;
  const llm = await parseConvertEstimateWithGemini(trimmed);
  if (llm) return llm;
  return parseConvertEstimateWithRegex(trimmed);
}

// ─── Estimate number formatter ────────────────────────────────────────────

/**
 * Generate a human-readable estimate "number" from the AbEstimate row's
 * id + createdAt. We don't persist this — keeping the schema unchanged
 * for PR 7. The format is `EST-${YYYY}-${last 4 of id, uppercased}`.
 */
export function formatEstimateNumber(estimate: { id: string; createdAt: Date | string }): string {
  const created = typeof estimate.createdAt === 'string' ? new Date(estimate.createdAt) : estimate.createdAt;
  const year = created.getUTCFullYear();
  const tail = (estimate.id || '').replace(/-/g, '').slice(-4).toUpperCase();
  return `EST-${year}-${tail || '0000'}`;
}

/**
 * Best-effort: given a "number" (EST-YYYY-XXXX), return the suffix used
 * by `formatEstimateNumber`. This is used for resolution by hint —
 * matchers compare against `formatEstimateNumber(row)`.
 */
export function parseEstimateNumberSuffix(num: string): { year: number; tail: string } | null {
  const m = num.match(/^EST-(\d{4})-([A-Z0-9]{2,8})$/i);
  if (!m) return null;
  return { year: parseInt(m[1], 10), tail: m[2].toUpperCase() };
}
