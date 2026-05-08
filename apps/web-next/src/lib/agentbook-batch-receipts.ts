/**
 * PR 18 — Multi-receipt batch upload (pure helpers).
 *
 * The bot used to fire 8 separate review prompts when a user forwarded
 * 8 photos in quick succession. This module owns the grouping logic so
 * the route handler can:
 *
 *   1. Append each photo to a per-chat batch (AbUserMemory key
 *      `telegram:photo_batch:<chatId>`).
 *   2. Wait for a brief idle window after the LAST photo (sliding).
 *   3. Process the whole batch in parallel, present ONE summary.
 *
 * No I/O here — kept pure so the unit tests stay offline. The route
 * wires `addPhotoToBatch` / `shouldProcessBatch` to AbUserMemory and
 * the OCR pipeline.
 */

import 'server-only';

export interface BatchPhoto {
  fileId: string;
  caption: string | null;
  ts: number;
}

export interface BatchState {
  items: BatchPhoto[];
  firstAt: number;
  lastAt: number;
}

export interface BatchSummaryInput {
  total: number;
  autoBooked: number;
  needsReview: number;
  failed: number;
  totalCents: number;
}

/**
 * Idle window after the last photo before the batch is processed.
 *
 * We deliberately keep this small (5s, not 60s) so the webhook handler
 * — running on Vercel with a per-function timeout — can `await` the
 * window inline without blowing past the limit. The original spec
 * floated 60s; in practice users forward photos within ~1-3s of each
 * other, so 5s comfortably groups them and still feels snappy.
 */
export const BATCH_IDLE_MS = 5_000;

/**
 * Append one photo to the batch state. Returns a new state object —
 * never mutates the input, so AbUserMemory writes are deterministic.
 */
export function addPhotoToBatch(state: BatchState | null, photo: BatchPhoto): BatchState {
  if (!state || state.items.length === 0) {
    return {
      items: [{ fileId: photo.fileId, caption: photo.caption, ts: photo.ts }],
      firstAt: photo.ts,
      lastAt: photo.ts,
    };
  }
  return {
    items: [...state.items, { fileId: photo.fileId, caption: photo.caption, ts: photo.ts }],
    firstAt: state.firstAt,
    lastAt: photo.ts,
  };
}

/**
 * Has the batch been idle long enough to flush? Sliding window: a new
 * photo always pushes the deadline out by `idleMs`.
 */
export function shouldProcessBatch(
  state: BatchState | null,
  now: number,
  idleMs: number = BATCH_IDLE_MS,
): boolean {
  if (!state || state.items.length === 0) return false;
  return now - state.lastAt >= idleMs;
}

export function isBatchActive(state: BatchState | null): boolean {
  return !!state && state.items.length > 0;
}

/**
 * Build the single summary message that replaces N per-receipt
 * dialogs. Plain text — the route wraps with HTML where it needs to.
 */
export function summarizeBatch(input: BatchSummaryInput): string {
  const { total, autoBooked, needsReview, failed } = input;
  const noun = total === 1 ? 'receipt' : 'receipts';
  const parts: string[] = [];
  if (autoBooked > 0) parts.push(`${autoBooked} auto-booked`);
  if (needsReview > 0) parts.push(`${needsReview} need your eyes`);
  if (failed > 0) parts.push(`${failed} couldn't be read`);
  const tail = parts.length > 0 ? ` — ${parts.join(', ')}` : '';
  const reviewTail = needsReview > 0 ? ' — review now?' : '';
  return `📒 ${total} ${noun} processed${tail}${reviewTail}`;
}
