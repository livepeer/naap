/**
 * Reference resolver. Maps a user's free-form reply ("the second one",
 * "INV-007", "Acme", "first") to one or more entities the bot just
 * mentioned in its previous turn.
 *
 * Pure function — takes a `MentionedEntity[]` snapshot from the
 * conversation context and the user's raw text. Never throws.
 *
 * Resolution order:
 *   1. Explicit "all" / "every" → all entities
 *   2. Ordinal word ("first", "second", ..., "last") → index
 *   3. Numeric "1" / "#2" / "3." → 1-based index
 *   4. Exact shortCode match (case-insensitive) — "INV-007"
 *   5. Substring match on label OR shortCode (case-insensitive) —
 *      "Acme" matches "Acme Corp · INV-2026-005"
 *   6. Single-entity short-circuit: when only one entity was mentioned
 *      AND the user replied with an affirmative ("yes", "ok", "do it"),
 *      we resolve to that entity. Reduces friction on confirmations.
 *
 * Returns:
 *   { kind: 'single', entity }   — exactly one match
 *   { kind: 'multiple', entities } — multiple ambiguous matches
 *   { kind: 'all', entities }    — explicit "all of them"
 *   { kind: 'none' }             — no match
 */

import 'server-only';
import type { MentionedEntity } from './agentbook-conversation-context';

export type ReferenceResolution =
  | { kind: 'single'; entity: MentionedEntity }
  | { kind: 'multiple'; entities: MentionedEntity[]; reason: string }
  | { kind: 'all'; entities: MentionedEntity[] }
  | { kind: 'none' };

const ORDINALS: Record<string, number> = {
  first: 1, '1st': 1,
  second: 2, '2nd': 2,
  third: 3, '3rd': 3,
  fourth: 4, '4th': 4,
  fifth: 5, '5th': 5,
  sixth: 6, '6th': 6,
};

const AFFIRMATIVE = /^(?:yes|yeah|yep|ok|okay|sure|do it|go ahead|sgtm|👍|✅)\b/i;
const ALL = /\b(?:all of them|all of the (?:above|invoices|expenses|items|todos|drafts)|every (?:one|invoice|expense)|all)\b/i;

export function resolveReference(text: string, entities: MentionedEntity[]): ReferenceResolution {
  if (!entities || entities.length === 0) return { kind: 'none' };
  const raw = (text || '').trim();
  if (!raw) return { kind: 'none' };
  const lower = raw.toLowerCase();

  // 1. "all of them"
  if (ALL.test(lower)) return { kind: 'all', entities };

  // 2. ordinal word
  for (const [word, idx] of Object.entries(ORDINALS)) {
    if (new RegExp(`\\b${word}\\b`).test(lower)) {
      if (idx <= entities.length) return { kind: 'single', entity: entities[idx - 1] };
    }
  }
  if (/\b(?:last|final|bottom)(?:\s+one)?\b/.test(lower)) {
    return { kind: 'single', entity: entities[entities.length - 1] };
  }

  // 3. numeric "1", "#2", "3.", "item 3"
  const numMatch = lower.match(/(?:^|\s|#)(\d+)(?:\.|\)|\s|$)/);
  if (numMatch) {
    const n = parseInt(numMatch[1], 10);
    if (n >= 1 && n <= entities.length) {
      return { kind: 'single', entity: entities[n - 1] };
    }
  }

  // 4. exact shortCode (case-insensitive, anywhere in the text)
  for (const e of entities) {
    if (e.shortCode && new RegExp(`\\b${escapeRegex(e.shortCode)}\\b`, 'i').test(raw)) {
      return { kind: 'single', entity: e };
    }
  }

  // 5. substring on label (case-insensitive). Filter to >= 3-char
  // tokens so "a" or "no" don't accidentally match every label.
  const tokens = lower.split(/[^a-z0-9-]+/i).filter((t) => t.length >= 3);
  if (tokens.length > 0) {
    const matched = entities.filter((e) => {
      const labelL = e.label.toLowerCase();
      const codeL = (e.shortCode || '').toLowerCase();
      return tokens.some((tok) => labelL.includes(tok) || codeL.includes(tok));
    });
    if (matched.length === 1) return { kind: 'single', entity: matched[0] };
    if (matched.length > 1) {
      return {
        kind: 'multiple',
        entities: matched,
        reason: `Matched ${matched.length} of the listed items — could you be more specific?`,
      };
    }
  }

  // 6. single-entity affirmative short-circuit
  if (entities.length === 1 && AFFIRMATIVE.test(lower)) {
    return { kind: 'single', entity: entities[0] };
  }

  return { kind: 'none' };
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Build mentioned-entity records from common shapes. Helpers for the
 * webhook adapter so each call site doesn't reinvent the shape.
 */
export function entityFromInvoice(
  index: number,
  inv: { id: string; number: string; client?: { name: string } | null; amountCents?: number },
): { index: number; kind: 'invoice'; id: string; label: string; shortCode?: string } {
  // Strip the year to give the user a short alias: INV-2026-007 → INV-007
  const shortCode = inv.number.replace(/-\d{4}-/, '-');
  const client = inv.client?.name ?? 'Client';
  return {
    index,
    kind: 'invoice',
    id: inv.id,
    label: `${client} · ${inv.number}`,
    shortCode: shortCode !== inv.number ? shortCode : undefined,
  };
}

export function entityFromExpense(
  index: number,
  exp: { id: string; description?: string | null; vendorName?: string | null; amountCents: number },
): { index: number; kind: 'expense'; id: string; label: string } {
  const label = exp.vendorName || exp.description || `Expense ${exp.id.slice(0, 6)}`;
  return { index, kind: 'expense', id: exp.id, label };
}
