/**
 * Tests for the multi-receipt batch-upload state machine (PR 18).
 *
 * Pure helpers — no DB, no Gemini calls, no Telegram I/O. The route
 * handler wires these to AbUserMemory and ctx.reply, and the e2e suite
 * covers the full HTTP path. These vitests pin the grouping/summary
 * contract.
 */

import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));

import {
  addPhotoToBatch,
  shouldProcessBatch,
  summarizeBatch,
  isBatchActive,
  BATCH_IDLE_MS,
  type BatchState,
  type BatchPhoto,
} from './agentbook-batch-receipts';

const photo = (fileId: string, ts: number, caption?: string): BatchPhoto => ({
  fileId, ts, caption: caption ?? null,
});

describe('addPhotoToBatch', () => {
  it('starts a new batch when state is null', () => {
    const next = addPhotoToBatch(null, photo('f1', 1000));
    expect(next.items).toHaveLength(1);
    expect(next.firstAt).toBe(1000);
    expect(next.lastAt).toBe(1000);
    expect(next.items[0].fileId).toBe('f1');
  });

  it('appends to an existing batch', () => {
    const s1 = addPhotoToBatch(null, photo('f1', 1000));
    const s2 = addPhotoToBatch(s1, photo('f2', 1500));
    const s3 = addPhotoToBatch(s2, photo('f3', 2000, 'lunch'));
    expect(s3.items).toHaveLength(3);
    expect(s3.firstAt).toBe(1000);
    expect(s3.lastAt).toBe(2000);
    expect(s3.items[2].caption).toBe('lunch');
  });

  it('preserves caption when provided', () => {
    const s = addPhotoToBatch(null, photo('f1', 1000, 'gas'));
    expect(s.items[0].caption).toBe('gas');
  });

  it('handles caption=null', () => {
    const s = addPhotoToBatch(null, photo('f1', 1000));
    expect(s.items[0].caption).toBeNull();
  });

  it('updates lastAt on every append', () => {
    let s: BatchState | null = null;
    s = addPhotoToBatch(s, photo('f1', 1000));
    s = addPhotoToBatch(s, photo('f2', 2000));
    s = addPhotoToBatch(s, photo('f3', 3000));
    expect(s.lastAt).toBe(3000);
    expect(s.firstAt).toBe(1000);
  });
});

describe('shouldProcessBatch', () => {
  it('returns false when no batch exists', () => {
    expect(shouldProcessBatch(null, 999_999)).toBe(false);
  });

  it('returns false while inside the idle window', () => {
    const s = addPhotoToBatch(null, photo('f1', 1000));
    // 4s after the last photo — still inside the 5s window
    expect(shouldProcessBatch(s, 1000 + 4000)).toBe(false);
  });

  it('returns true after the idle window has elapsed since the LAST photo', () => {
    let s: BatchState | null = null;
    s = addPhotoToBatch(s, photo('f1', 1000));
    s = addPhotoToBatch(s, photo('f2', 2000));
    s = addPhotoToBatch(s, photo('f3', 3000));
    // 5s after the last (3000) → 8000 inclusive boundary
    expect(shouldProcessBatch(s, 3000 + BATCH_IDLE_MS)).toBe(true);
  });

  it('a new photo resets the idle window (sliding)', () => {
    let s: BatchState | null = null;
    s = addPhotoToBatch(s, photo('f1', 1000));
    // Without a new photo, would process at 1000 + IDLE.
    // But a new photo arrives at 4000 — must defer past 4000 + IDLE.
    s = addPhotoToBatch(s, photo('f2', 4000));
    expect(shouldProcessBatch(s, 1000 + BATCH_IDLE_MS)).toBe(false);
    expect(shouldProcessBatch(s, 4000 + BATCH_IDLE_MS - 1)).toBe(false);
    expect(shouldProcessBatch(s, 4000 + BATCH_IDLE_MS)).toBe(true);
  });

  it('respects custom idleMs override', () => {
    const s = addPhotoToBatch(null, photo('f1', 1000));
    // 2000 - 1000 = 1000 >= idleMs(1000) → process
    expect(shouldProcessBatch(s, 2000, 1000)).toBe(true);
    // 1100 - 1000 = 100 < 1000 → wait
    expect(shouldProcessBatch(s, 1100, 1000)).toBe(false);
  });
});

describe('isBatchActive', () => {
  it('returns false when no items', () => {
    expect(isBatchActive(null)).toBe(false);
    expect(isBatchActive({ items: [], firstAt: 0, lastAt: 0 })).toBe(false);
  });

  it('returns true with items', () => {
    const s = addPhotoToBatch(null, photo('f1', 1000));
    expect(isBatchActive(s)).toBe(true);
  });
});

describe('summarizeBatch', () => {
  it('summarises an all-auto-booked batch', () => {
    const text = summarizeBatch({
      total: 8,
      autoBooked: 8,
      needsReview: 0,
      failed: 0,
      totalCents: 12345,
    });
    expect(text).toMatch(/8 receipts/);
    expect(text).toMatch(/8 auto-booked/);
    // No "needs review" mention when zero
    expect(text).not.toMatch(/need your eyes/);
  });

  it('summarises a mixed batch — the canonical PR 18 example', () => {
    const text = summarizeBatch({
      total: 8,
      autoBooked: 6,
      needsReview: 2,
      failed: 0,
      totalCents: 50000,
    });
    expect(text).toMatch(/8 receipts/);
    expect(text).toMatch(/6 auto-booked/);
    expect(text).toMatch(/2 need your eyes/);
  });

  it('summarises an all-review batch', () => {
    const text = summarizeBatch({
      total: 3,
      autoBooked: 0,
      needsReview: 3,
      failed: 0,
      totalCents: 0,
    });
    expect(text).toMatch(/3 receipts/);
    expect(text).toMatch(/3 need your eyes/);
    expect(text).not.toMatch(/auto-booked/);
  });

  it('mentions failed receipts when present', () => {
    const text = summarizeBatch({
      total: 5,
      autoBooked: 3,
      needsReview: 1,
      failed: 1,
      totalCents: 10000,
    });
    expect(text).toMatch(/5 receipts/);
    expect(text).toMatch(/3 auto-booked/);
    expect(text).toMatch(/1 need your eyes/);
    expect(text).toMatch(/1.*(unread|couldn't|failed)/i);
  });

  it('uses singular "receipt" / plural "receipts" correctly', () => {
    const one = summarizeBatch({
      total: 1, autoBooked: 1, needsReview: 0, failed: 0, totalCents: 100,
    });
    expect(one).toMatch(/1 receipt /);

    const two = summarizeBatch({
      total: 2, autoBooked: 2, needsReview: 0, failed: 0, totalCents: 100,
    });
    expect(two).toMatch(/2 receipts/);
  });
});

describe('BATCH_IDLE_MS', () => {
  it('is a small positive window, not minutes', () => {
    // The plan settled on 5s — keep it under 30s so the webhook doesn't
    // hit Vercel's per-function timeout. Pin it.
    expect(BATCH_IDLE_MS).toBeGreaterThan(1000);
    expect(BATCH_IDLE_MS).toBeLessThanOrEqual(30_000);
  });
});
