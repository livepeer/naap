/**
 * Tests for soft-delete helpers (PR 26).
 *
 * The soft-delete contract for AgentBook:
 *
 *   - DELETE on a financial entity sets `deletedAt = new Date()` instead
 *     of removing the row.
 *   - List/detail endpoints filter out rows where `deletedAt IS NOT NULL`
 *     by default; callers opt in via `?includeDeleted=true`.
 *   - Restoration is allowed within 90 days of the soft-delete; older
 *     rows are rejected (and eventually purged by the housekeeping cron).
 *   - The tax package (PR 5) intentionally INCLUDES rows that were
 *     deleted *after* the close of the tax year — they belonged to the
 *     books at year-end and must remain on the year's filing.
 *
 * These tests pin the helpers:
 *   1. `withSoftDelete(where, includeDeleted)` — list/detail filter.
 *   2. `canRestore(deletedAt, now)` — 90-day window check.
 *   3. `taxYearWhere(endOfTaxYear)` — "live or deleted-after-year-end".
 *
 * Pure unit tests; no Prisma, no fs, no time fakes beyond passing `now`
 * explicitly so the helpers remain deterministic.
 */

import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import {
  withSoftDelete,
  canRestore,
  taxYearWhere,
  RESTORE_WINDOW_DAYS,
} from './agentbook-soft-delete';

describe('withSoftDelete', () => {
  it('adds deletedAt: null to the where clause by default', () => {
    const result = withSoftDelete({ tenantId: 't1' }, false);
    expect(result).toEqual({ tenantId: 't1', deletedAt: null });
  });

  it('does not touch where when includeDeleted=true', () => {
    const result = withSoftDelete({ tenantId: 't1' }, true);
    expect(result).toEqual({ tenantId: 't1' });
  });

  it('preserves existing keys', () => {
    const result = withSoftDelete({ tenantId: 't1', status: 'confirmed' }, false);
    expect(result).toEqual({ tenantId: 't1', status: 'confirmed', deletedAt: null });
  });

  it('does not mutate the input where', () => {
    const input: Record<string, unknown> = { tenantId: 't1' };
    withSoftDelete(input, false);
    expect(input).toEqual({ tenantId: 't1' });
  });
});

describe('canRestore', () => {
  const now = new Date('2026-05-06T12:00:00Z');

  it('returns false when deletedAt is null (row is live)', () => {
    expect(canRestore(null, now)).toBe(false);
  });

  it('allows restoration on day 0 (just deleted)', () => {
    expect(canRestore(now, now)).toBe(true);
  });

  it('allows restoration at exactly the 90-day boundary', () => {
    const deletedAt = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
    expect(canRestore(deletedAt, now)).toBe(true);
  });

  it('rejects restoration beyond 90 days', () => {
    const deletedAt = new Date(now.getTime() - 91 * 24 * 60 * 60 * 1000);
    expect(canRestore(deletedAt, now)).toBe(false);
  });

  it('exposes the 90-day constant', () => {
    expect(RESTORE_WINDOW_DAYS).toBe(90);
  });
});

describe('taxYearWhere', () => {
  it('emits OR over deletedAt: null and deletedAt > endOfTaxYear', () => {
    const endOfYear = new Date('2025-12-31T23:59:59.999Z');
    const result = taxYearWhere(endOfYear);
    expect(result).toEqual({
      OR: [
        { deletedAt: null },
        { deletedAt: { gt: endOfYear } },
      ],
    });
  });

  it('returns a fresh object each call (no shared state)', () => {
    const endOfYear = new Date('2025-12-31T23:59:59.999Z');
    const a = taxYearWhere(endOfYear);
    const b = taxYearWhere(endOfYear);
    expect(a).not.toBe(b);
  });
});
