/**
 * Per-tenant daily-briefing preferences.
 *
 * Storage: AbUserMemory under "telegram:digest_prefs". Setup is a
 * conversational dialog (the user runs through it once) and the user
 * can give feedback to tune it on every subsequent digest.
 *
 * Two helpers live here:
 *   • getDigestPrefs / setDigestPrefs — read/write the JSON
 *   • applyFeedbackToPrefs — Gemini-driven interpretation of free-form
 *     user feedback ("shorter", "skip tax tips", "move to 8am", "more
 *     cash flow detail") into a typed prefs delta.
 */

import 'server-only';
import { prisma as db } from '@naap/database';

export interface DigestSections {
  cashOnHand: boolean;
  yesterday: boolean;
  pendingReview: boolean;
  overdue: boolean;
  thisWeek: boolean;
  anomalies: boolean;
  taxDeadline: boolean;
  taxTips: boolean;
  cashFlowTips: boolean;
  autoCategorize: boolean;
  budgets: boolean;
  cpa_requests: boolean;             // PR 11: open CPA follow-ups
  deductions: boolean;               // PR 12: smart deduction discovery hits
  receipts: boolean;                 // PR 16: receipt-expiry warnings (>14d, no receipt)
  highlights: boolean;               // top-of-digest 1-3 must-know bullets
  snapshot: boolean;                 // cash + AR + MTD spend quick-glance
  todos: boolean;                    // bottom-of-digest prioritized action list
}

export interface DigestPrefs {
  hour: number;       // 0-23 local
  minute: number;     // 0-59
  tone: 'concise' | 'detailed';
  sections: DigestSections;
  setupComplete: boolean;
}

export const DEFAULT_PREFS: DigestPrefs = {
  // Default to 6:00 LOCAL — the digest arrives before 7am so users wake to
  // it. The cron fires hourly on the hour; users can move it via "setup
  // briefing" or "move to 7am"/"move to 8am" replies.
  hour: 6,
  minute: 0,
  tone: 'detailed',
  sections: {
    cashOnHand: true,
    yesterday: true,
    pendingReview: true,
    overdue: true,
    thisWeek: true,
    anomalies: true,
    taxDeadline: true,
    taxTips: true,
    cashFlowTips: true,
    autoCategorize: true,
    budgets: true,
    cpa_requests: true,                // default-on; cheap and useful
    deductions: true,                  // PR 12: default-on; one bot msg / cycle worst-case
    receipts: true,                    // PR 16: default-on; only fires for >14d business expenses
    highlights: true,                  // top-of-digest 1-3 must-know bullets
    snapshot: true,                    // 3-line quick-glance state
    todos: true,                       // bottom-of-digest prioritized action list
  },
  setupComplete: false,
};

const PREFS_KEY = 'telegram:digest_prefs';
const SETUP_STATE_KEY = 'telegram:digest_setup_state';

export async function getDigestPrefs(tenantId: string): Promise<DigestPrefs> {
  const memory = await db.abUserMemory.findUnique({
    where: { tenantId_key: { tenantId, key: PREFS_KEY } },
  });
  if (!memory) return { ...DEFAULT_PREFS };
  try {
    const parsed = JSON.parse(memory.value) as Partial<DigestPrefs>;
    return mergeWithDefaults(parsed);
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export async function setDigestPrefs(tenantId: string, prefs: DigestPrefs): Promise<void> {
  const value = JSON.stringify(prefs);
  await db.abUserMemory.upsert({
    where: { tenantId_key: { tenantId, key: PREFS_KEY } },
    update: { value, lastUsed: new Date() },
    create: { tenantId, key: PREFS_KEY, value, type: 'preference', confidence: 1 },
  });
}

function mergeWithDefaults(partial: Partial<DigestPrefs>): DigestPrefs {
  return {
    hour: typeof partial.hour === 'number' ? partial.hour : DEFAULT_PREFS.hour,
    minute: typeof partial.minute === 'number' ? partial.minute : DEFAULT_PREFS.minute,
    tone: partial.tone === 'concise' ? 'concise' : 'detailed',
    sections: { ...DEFAULT_PREFS.sections, ...(partial.sections || {}) },
    setupComplete: !!partial.setupComplete,
  };
}

// ─── Setup state (multi-turn dialog) ─────────────────────────────────────

export type SetupStep = 'time' | 'sections' | 'preview' | 'tuning';

export interface SetupState {
  step: SetupStep;
  draft: DigestPrefs;
  startedAt: number;
}

export async function getSetupState(tenantId: string): Promise<SetupState | null> {
  const memory = await db.abUserMemory.findUnique({
    where: { tenantId_key: { tenantId, key: SETUP_STATE_KEY } },
  });
  if (!memory) return null;
  try {
    const parsed = JSON.parse(memory.value) as SetupState;
    // Stale state (>1 hour) → discard so the user isn't stuck mid-flow.
    if (Date.now() - parsed.startedAt > 60 * 60 * 1000) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function setSetupState(tenantId: string, state: SetupState): Promise<void> {
  const value = JSON.stringify(state);
  await db.abUserMemory.upsert({
    where: { tenantId_key: { tenantId, key: SETUP_STATE_KEY } },
    update: { value, lastUsed: new Date() },
    create: { tenantId, key: SETUP_STATE_KEY, value, type: 'pending_action', confidence: 1 },
  });
}

export async function clearSetupState(tenantId: string): Promise<void> {
  await db.abUserMemory.deleteMany({
    where: { tenantId, key: SETUP_STATE_KEY },
  });
}

// ─── Free-form text → prefs interpretation ───────────────────────────────

/**
 * Parse a time string like "7am", "8:30", "morning", "9 pm", "noon"
 * into hour/minute. Returns null if it can't be confidently parsed.
 */
export function parseTimeString(input: string): { hour: number; minute: number } | null {
  const lower = input.toLowerCase().trim();
  if (/\b(morning|early)\b/.test(lower)) return { hour: 7, minute: 0 };
  if (/\bnoon\b/.test(lower)) return { hour: 12, minute: 0 };
  if (/\b(midday|lunch)\b/.test(lower)) return { hour: 12, minute: 0 };
  if (/\b(afternoon)\b/.test(lower)) return { hour: 14, minute: 0 };
  if (/\b(evening|night)\b/.test(lower)) return { hour: 20, minute: 0 };

  // "8am" / "9 pm" / "10:30am" / "9:15 pm" / "7" / "8:30"
  const ampmMatch = lower.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
  if (!ampmMatch) return null;
  let hour = parseInt(ampmMatch[1], 10);
  const minute = ampmMatch[2] ? parseInt(ampmMatch[2], 10) : 0;
  const ampm = ampmMatch[3];
  if (isNaN(hour) || hour < 0 || hour > 23) return null;
  if (isNaN(minute) || minute < 0 || minute > 59) return null;
  if (ampm === 'pm' && hour < 12) hour += 12;
  if (ampm === 'am' && hour === 12) hour = 0;
  return { hour, minute };
}

interface FeedbackDelta {
  changes: Array<{
    field: string;
    value: unknown;
    description: string;
  }>;
  satisfied: boolean;
  unparseable: boolean;
}

/**
 * Use Gemini to interpret free-form feedback into a structured delta
 * over DigestPrefs. Falls back to regex for the common one-shot
 * patterns ("shorter", "skip tax tips", "8am") so simple cases don't
 * burn an LLM call.
 */
export async function applyFeedbackToPrefs(
  current: DigestPrefs,
  userFeedback: string,
): Promise<{ updated: DigestPrefs; explanations: string[]; satisfied: boolean }> {
  // Cheap regex first
  const regexDelta = parseFeedbackWithRegex(userFeedback, current);
  if (regexDelta) {
    return {
      updated: regexDelta.updated,
      explanations: regexDelta.explanations,
      satisfied: regexDelta.satisfied,
    };
  }

  const llmDelta = await parseFeedbackWithGemini(userFeedback, current);
  if (llmDelta && !llmDelta.unparseable) {
    const updated = applyDelta(current, llmDelta);
    return {
      updated,
      explanations: llmDelta.changes.map((c) => c.description),
      satisfied: llmDelta.satisfied,
    };
  }

  return {
    updated: current,
    explanations: ['I didn\'t catch what to change. Try "shorter", "skip tax tips", "move to 8am", or "good".'],
    satisfied: false,
  };
}

function parseFeedbackWithRegex(input: string, current: DigestPrefs): {
  updated: DigestPrefs;
  explanations: string[];
  satisfied: boolean;
} | null {
  const lower = input.toLowerCase().trim();
  // Satisfied — terminal state
  if (/^(good|great|perfect|done|save|looks good|that('?s| is) it|sgtm|👍|✅)\b/.test(lower)) {
    return { updated: current, explanations: ['Saved.'], satisfied: true };
  }

  const updated: DigestPrefs = { ...current, sections: { ...current.sections } };
  const explanations: string[] = [];

  // Time changes
  const timeMatch = lower.match(/\b(?:at|to|move to|change to|send (?:it )?at)?\s*(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\b/);
  if (timeMatch && /\b(morning|noon|am|pm|\d:\d|^\d{1,2}\s*$)/.test(lower)) {
    const t = parseTimeString(timeMatch[1]);
    if (t) {
      updated.hour = t.hour;
      updated.minute = t.minute;
      explanations.push(`Briefing time set to ${formatTime(updated.hour, updated.minute)}.`);
    }
  }

  // Tone
  if (/\b(short|brief|concise|tight|less detail|terse)\b/.test(lower)) {
    updated.tone = 'concise';
    explanations.push('Switched to concise tone.');
  } else if (/\b(detail|verbose|thorough|deep|long)\b/.test(lower)) {
    updated.tone = 'detailed';
    explanations.push('Switched to detailed tone.');
  }

  // Section toggles — "skip / drop / no / remove" + section name
  const off = /\b(skip|drop|no more|remove|hide|don'?t (?:show|include)|without|less)\s+(.+)/.exec(lower);
  if (off) toggleSections(off[2], false, updated.sections, explanations);

  const on = /\b(add|include|show|with|more (?:of)?|bring back)\s+(.+)/.exec(lower);
  if (on) toggleSections(on[2], true, updated.sections, explanations);

  if (explanations.length === 0) return null;
  return { updated, explanations, satisfied: false };
}

function toggleSections(
  fragment: string,
  on: boolean,
  sections: DigestSections,
  explanations: string[],
): void {
  const f = fragment.toLowerCase();
  const map: Array<[RegExp, keyof DigestSections, string]> = [
    [/\b(cash\s*(on hand)?|balance)\b/, 'cashOnHand', 'cash on hand'],
    [/\b(yesterday|prior day)\b/, 'yesterday', 'yesterday\'s flow'],
    [/\b(pending|drafts?|review)\b/, 'pendingReview', 'pending-review count'],
    [/\b(overdue|aging)\b/, 'overdue', 'overdue invoices'],
    [/\b(this week|upcoming|next 7)\b/, 'thisWeek', 'this-week schedule'],
    [/\b(anomal|unusual)\b/, 'anomalies', 'anomaly alerts'],
    [/\b(tax (deadline|date)|quarterly)\b/, 'taxDeadline', 'tax deadlines'],
    [/\btax tips?\b/, 'taxTips', 'tax planning tips'],
    [/\bcash[- ]?flow tips?\b/, 'cashFlowTips', 'cash-flow tips'],
    [/\b(auto[- ]?categor|categori)\b/, 'autoCategorize', 'auto-categorizer summary'],
    [/\b(budget|spending\s+caps?|cap)\b/, 'budgets', 'budget progress'],
    [/\b(cpa|accountant)\s*(requests?|asks?|follow[\- ]?ups?)?\b/, 'cpa_requests', 'CPA follow-ups'],
    [/\b(deduction|missed deduction|write[- ]?off)s?\b/, 'deductions', 'missed-deduction tips'],
    [/\b(receipt|missing receipt)s?\b/, 'receipts', 'missing-receipt warnings'],
    [/\b(highlight|top\s+note)s?\b/, 'highlights', 'highlights'],
    [/\b(snapshot|quick\s*glance|at\s+a\s+glance)\b/, 'snapshot', 'snapshot'],
    [/\b(to[- ]?dos?|action\s*list|action\s*items?)\b/, 'todos', 'TODO list'],
    [/\ball (the )?tips?\b/, 'taxTips', 'all tips'],
  ];
  for (const [re, key, label] of map) {
    if (re.test(f)) {
      sections[key] = on;
      if (key === 'taxTips' && /\ball\b/.test(f)) sections.cashFlowTips = on;
      explanations.push(`${on ? 'Including' : 'Skipping'} ${label}.`);
    }
  }
}

async function parseFeedbackWithGemini(
  userFeedback: string,
  current: DigestPrefs,
): Promise<FeedbackDelta | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  const model = process.env.GEMINI_MODEL_FAST || 'gemini-2.0-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const systemPrompt = `Interpret the user's feedback on their daily briefing and emit a structured delta.

Current prefs:
${JSON.stringify(current, null, 2)}

Field domain:
   hour: 0-23 (local time)
   minute: 0-59
   tone: "concise" | "detailed"
   sections.* (each true|false):
      cashOnHand, yesterday, pendingReview, overdue, thisWeek, anomalies,
      taxDeadline, taxTips, cashFlowTips, autoCategorize, budgets,
      cpa_requests, deductions, receipts, highlights, snapshot, todos

Return ONLY JSON:
{
  "changes": [
    { "field": "tone", "value": "concise", "description": "Switched to concise tone." },
    { "field": "sections.taxTips", "value": false, "description": "Skipping tax planning tips." }
  ],
  "satisfied": false,
  "unparseable": false
}

If the user said something like "good" / "save it" / "that's perfect", return satisfied=true and changes=[].
If the feedback is unrelated to digest tuning, return unparseable=true.`;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: 'user', parts: [{ text: userFeedback }] }],
        generationConfig: { maxOutputTokens: 400, temperature: 0.1 },
      }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    const raw = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const json = cleaned.match(/\{[\s\S]*\}/)?.[0] || cleaned;
    return JSON.parse(json) as FeedbackDelta;
  } catch {
    return null;
  }
}

function applyDelta(current: DigestPrefs, delta: FeedbackDelta): DigestPrefs {
  const updated: DigestPrefs = { ...current, sections: { ...current.sections } };
  for (const change of delta.changes) {
    const path = change.field.split('.');
    if (path.length === 1) {
      const key = path[0] as keyof DigestPrefs;
      if (key === 'hour' && typeof change.value === 'number') updated.hour = change.value;
      else if (key === 'minute' && typeof change.value === 'number') updated.minute = change.value;
      else if (key === 'tone' && (change.value === 'concise' || change.value === 'detailed')) {
        updated.tone = change.value;
      }
    } else if (path.length === 2 && path[0] === 'sections') {
      const key = path[1] as keyof DigestSections;
      if (typeof change.value === 'boolean' && key in updated.sections) {
        updated.sections[key] = change.value;
      }
    }
  }
  return updated;
}

export function formatTime(hour: number, minute: number): string {
  const h12 = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
  const ampm = hour < 12 ? 'am' : 'pm';
  return minute === 0 ? `${h12}${ampm}` : `${h12}:${String(minute).padStart(2, '0')}${ampm}`;
}

export function formatPrefsSummary(p: DigestPrefs): string {
  const on: string[] = [];
  const off: string[] = [];
  const labels: Record<keyof DigestSections, string> = {
    cashOnHand: 'cash on hand',
    yesterday: 'yesterday\'s flow',
    pendingReview: 'pending-review count',
    overdue: 'overdue invoices',
    thisWeek: 'this week schedule',
    anomalies: 'anomaly alerts',
    taxDeadline: 'tax deadline countdown',
    taxTips: 'tax planning tips',
    cashFlowTips: 'cash-flow tips',
    autoCategorize: 'auto-categorizer summary',
    budgets: 'budget progress',
    cpa_requests: 'CPA follow-ups',
    deductions: 'missed deductions',
    receipts: 'missing-receipt warnings',
  };
  for (const k of Object.keys(labels) as (keyof DigestSections)[]) {
    (p.sections[k] ? on : off).push(labels[k]);
  }
  const lines = [
    `⏰ Time: <b>${formatTime(p.hour, p.minute)}</b>`,
    `🎚️ Tone: <b>${p.tone}</b>`,
    `✅ Including: ${on.join(', ')}`,
  ];
  if (off.length > 0) lines.push(`⏭️ Skipping: ${off.join(', ')}`);
  return lines.join('\n');
}
