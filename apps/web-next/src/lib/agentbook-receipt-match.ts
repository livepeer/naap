/**
 * PR 16 — Receipt-expiry warnings.
 *
 * Pure helpers for the bot intent `manage_receipt_request`:
 *
 *   • parseManageReceiptCommand — recognises the regex shape
 *     /^(send|skip) receipt for (.+)$/i and returns {action, target}.
 *   • scoreExpenseMatch — token-overlap score (0..1) between a free-form
 *     target like "AWS October bill" and an expense's description+vendor.
 *   • pickBestExpenseMatch — returns the highest-scoring expense above a
 *     confidence floor, or null when nothing is a clear winner.
 *
 * No I/O — kept pure so the unit tests stay offline and the route handlers
 * + telegram webhook can both share the same matching contract.
 */

import 'server-only';

export interface ParsedManageReceiptCommand {
  action: 'send' | 'skip';
  target: string;
}

export interface ExpenseMatchCandidate {
  id?: string;
  description: string | null;
  vendor: string | null;
}

const MANAGE_RECEIPT_RE = /^(?:send|skip)\s+receipt\s+for\s+(.+)$/i;

const STOPWORDS = new Set([
  'a', 'an', 'the', 'for', 'of', 'on', 'at', 'in', 'to', 'with', 'and', 'or',
  'my', 'your', 'this', 'that', 'these', 'those',
  // Generic accounting words we don't want to score on.
  'bill', 'receipt', 'expense', 'payment', 'invoice',
]);

const MIN_MATCH_SCORE = 0.45;

/**
 * Recognise "send receipt for X" / "skip receipt for X". Returns null when
 * the input is unrelated or has an empty target.
 */
export function parseManageReceiptCommand(input: string): ParsedManageReceiptCommand | null {
  if (!input) return null;
  const trimmed = input.trim();
  const match = trimmed.match(MANAGE_RECEIPT_RE);
  if (!match) return null;
  const verb = trimmed.slice(0, 4).toLowerCase() === 'send' ? 'send' : 'skip';
  // Strip trailing punctuation/whitespace from the captured target.
  const target = match[1].replace(/[\s.,;:!?]+$/g, '').trim();
  if (!target) return null;
  return { action: verb, target };
}

/**
 * Tokenise a string into lowercase non-stopword tokens. Drops anything
 * shorter than 2 characters and filters the STOPWORDS set so common
 * filler words ("the", "for", "bill") don't dominate the score.
 */
function tokenize(s: string | null | undefined): string[] {
  if (!s) return [];
  return s
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 2 && !STOPWORDS.has(t));
}

/**
 * Score the overlap between the user's `target` phrase and an expense's
 * description+vendor. The result is a Jaccard-ish ratio in [0, 1] — the
 * fraction of target tokens that appear in the candidate, weighted so
 * that a vendor match counts the same as a description match.
 */
export function scoreExpenseMatch(target: string, candidate: ExpenseMatchCandidate): number {
  const targetTokens = tokenize(target);
  if (targetTokens.length === 0) return 0;

  const candidateTokens = new Set([
    ...tokenize(candidate.description),
    ...tokenize(candidate.vendor),
  ]);
  if (candidateTokens.size === 0) return 0;

  let hits = 0;
  for (const tok of targetTokens) {
    if (candidateTokens.has(tok)) hits++;
  }
  return hits / targetTokens.length;
}

/**
 * Highest-scoring expense above the confidence floor. Ties broken by the
 * order they appear in the input list (so callers can pre-sort by recency
 * for sensible disambiguation when token scores collide).
 */
export function pickBestExpenseMatch<T extends ExpenseMatchCandidate>(
  target: string,
  candidates: T[],
): T | null {
  if (candidates.length === 0) return null;
  let best: T | null = null;
  let bestScore = 0;
  for (const c of candidates) {
    const s = scoreExpenseMatch(target, c);
    if (s > bestScore) {
      bestScore = s;
      best = c;
    }
  }
  if (!best || bestScore < MIN_MATCH_SCORE) return null;
  return best;
}
