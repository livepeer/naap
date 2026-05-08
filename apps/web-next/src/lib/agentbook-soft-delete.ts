/**
 * Soft-delete helpers (PR 26).
 *
 * Financial entities (expenses, invoices, clients, vendors, budgets,
 * mileage entries) carry a nullable `deletedAt` column. DELETE handlers
 * stamp `deletedAt = new Date()` instead of removing the row, list/detail
 * endpoints filter on `deletedAt: null` by default, and a daily cron
 * purges rows past the 90-day restoration window.
 *
 * Three small helpers are enough to make the policy consistent across
 * ~20 endpoints:
 *
 *   - withSoftDelete(where, includeDeleted)  — list/detail filter
 *   - canRestore(deletedAt, now)             — 90-day window check
 *   - taxYearWhere(endOfTaxYear)             — keep deleted-after-Dec-31
 *                                              rows in their year's
 *                                              tax package (PR 5)
 *
 * Pure data — no Prisma import, no I/O. The helpers are exercised in
 * `agentbook-soft-delete.test.ts` and consumed by route handlers and
 * the tax-package builder.
 */

import 'server-only';

/**
 * Days a soft-deleted row remains restorable. The housekeeping cron
 * (`/agentbook/cron/purge-deleted`) hard-deletes rows older than this.
 */
export const RESTORE_WINDOW_DAYS = 90;

const RESTORE_WINDOW_MS = RESTORE_WINDOW_DAYS * 24 * 60 * 60 * 1000;

/**
 * Adds `deletedAt: null` to a Prisma `where` clause unless the caller
 * explicitly opted in to deleted rows. Returns a *new* object so the
 * input is not mutated — important when the same `where` is reused
 * across multiple `findMany`/`count` calls.
 */
export function withSoftDelete<T extends Record<string, unknown>>(
  where: T,
  includeDeleted: boolean,
): T & { deletedAt?: null } {
  if (includeDeleted) return { ...where };
  return { ...where, deletedAt: null };
}

/**
 * `true` when the row is within the 90-day restore window. Returns
 * `false` for live rows (`deletedAt === null`) — the caller should be
 * checking that case before invoking restore at all, but defending in
 * depth keeps the helper safe.
 */
export function canRestore(deletedAt: Date | null, now: Date): boolean {
  if (deletedAt === null) return false;
  const ageMs = now.getTime() - deletedAt.getTime();
  return ageMs <= RESTORE_WINDOW_MS;
}

/**
 * `where` fragment for the tax package: include rows that are live
 * *or* were deleted after the close of the tax year. A row deleted on
 * Feb 3 of the following year still belonged to the year-end books and
 * must remain on that year's filing.
 */
export function taxYearWhere(endOfTaxYear: Date): {
  OR: Array<{ deletedAt: null } | { deletedAt: { gt: Date } }>;
} {
  return {
    OR: [
      { deletedAt: null },
      { deletedAt: { gt: endOfTaxYear } },
    ],
  };
}

/**
 * Parse the `?includeDeleted=true` query param consistently. Defaults
 * to `false` for any value that isn't exactly `'true'` (case-insensitive).
 */
export function parseIncludeDeleted(searchParams: URLSearchParams): boolean {
  const raw = searchParams.get('includeDeleted');
  return raw !== null && raw.toLowerCase() === 'true';
}
