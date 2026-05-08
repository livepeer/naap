/**
 * Idempotency helper for the Telegram webhook (PR 21).
 *
 * Telegram retries webhook deliveries when the receiver times out or
 * 5xx's. Without dedup, a retry could double-book an expense or
 * re-create an invoice. This module owns the claim/cache contract:
 *
 *   - claimKey            — race-safe "first one wins" via the unique
 *                           PK on `AbIdempotencyKey`. Returns true on
 *                           the first call, false on collisions
 *                           (Prisma P2002).
 *   - recordResponse      — best-effort cache of the response body so
 *                           a later replay can return the same payload.
 *   - getCachedResponse   — fetch the cached body for a key, or null.
 *   - pruneIdempotencyKeys — daily housekeeping: drop rows past the
 *                           retention window (default 24h, well past
 *                           Telegram's retry budget).
 *
 * Tenant scope: writes carry the tenantId so we can reason about who
 * owns each row, but reads use the key alone — by construction a
 * `tg_update:<id>` is globally unique across tenants (Telegram update
 * ids are monotonic per bot).
 */

import 'server-only';
import { prisma as db } from '@naap/database';

export interface IdemKey {
  key: string;
  tenantId?: string;
}

export interface IdemResult<T> {
  cached: boolean;
  response?: T;
}

/**
 * Claim an idempotency key. Returns true on the first claim, false if
 * the key was already taken (the caller should short-circuit and let
 * `getCachedResponse` deliver the previous reply).
 *
 * Race-safe: relies on the unique PK on `AbIdempotencyKey.key`. Two
 * concurrent retries both call `create`, exactly one succeeds, the
 * loser hits Prisma error code P2002 and is mapped to `false`.
 */
export async function claimKey(key: string, tenantId: string): Promise<boolean> {
  try {
    await db.abIdempotencyKey.create({
      data: { key, tenantId },
    });
    return true;
  } catch (err) {
    if (
      typeof err === 'object' &&
      err !== null &&
      'code' in err &&
      (err as { code: string }).code === 'P2002'
    ) {
      // Lost the race — the key was already claimed by an earlier
      // delivery (or a concurrent retry). The caller should treat this
      // as a duplicate and respond with the cached body.
      return false;
    }
    // Real DB error — let the route handler decide (it currently
    // returns `{ ok: true }` to keep Telegram from retrying further).
    throw err;
  }
}

/**
 * Cache the response body so a replay can return the original payload
 * verbatim. Best-effort: a write failure here doesn't roll back the
 * already-completed work, so we swallow it and let the next replay
 * fall through to the generic idempotent marker.
 */
export async function recordResponse(
  key: string,
  response: unknown,
): Promise<void> {
  try {
    await db.abIdempotencyKey.update({
      where: { key },
      data: { response: response as never },
    });
  } catch (err) {
    console.warn('[idempotency] recordResponse failed:', err);
  }
}

/**
 * Look up the cached response for a previously-claimed key. Returns
 * `null` if the key was never claimed, or was claimed but never had
 * its response written (e.g. handler crashed mid-flight).
 */
export async function getCachedResponse(key: string): Promise<unknown | null> {
  const row = await db.abIdempotencyKey.findUnique({ where: { key } });
  if (!row || row.response == null) return null;
  return row.response as unknown;
}

export interface PruneOptions {
  /** Retain rows newer than this many hours. Defaults to 24. */
  olderThanHours?: number;
}

export interface PruneResult {
  deleted: number;
}

/**
 * Daily housekeeping — drop rows older than `olderThanHours` (default
 * 24). Telegram's retry window is much shorter than that, so anything
 * past 24 hours has no chance of being a meaningful replay.
 */
export async function pruneIdempotencyKeys(
  opts: PruneOptions = {},
): Promise<PruneResult> {
  const hours = opts.olderThanHours ?? 24;
  const cutoff = new Date(Date.now() - hours * 3_600_000);
  const res = await db.abIdempotencyKey.deleteMany({
    where: { createdAt: { lt: cutoff } },
  });
  return { deleted: res.count };
}
