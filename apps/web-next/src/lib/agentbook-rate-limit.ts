/**
 * Bot rate-limit helper (PR 25).
 *
 * Per-tenant ceilings on inbound bot messages so a runaway client
 * (or a malicious user) can't burn down our LLM budget. Two windows:
 *
 *   - perMinute  (default 60) — protects against bursty floods.
 *   - perDay     (default 1000) — protects against a 24h trickle that
 *                                  still adds up to a real bill.
 *
 * Storage strategy: AbUserMemory rows keyed by
 *   `rate:<channel>:minute`  and  `rate:<channel>:day`
 * with `value = JSON.stringify({ bucket, count })`. The bucket is a
 * coarse epoch number (minute-of-epoch for the minute key, day-of-epoch
 * for the day key). When a request arrives in a different bucket than
 * what's stored, we treat the counter as fresh — that's how the
 * sliding-window-by-bucket resets cleanly across boundaries.
 *
 * Why AbUserMemory (and not e.g. Redis): the codebase already uses
 * AbUserMemory for similar lightweight per-tenant K/V (digest prefs,
 * setup state, etc), and the table is tenant-indexed so this
 * automatically inherits tenant scope. No new infra to operate.
 *
 * Concurrency: two near-simultaneous requests can both read count=N
 * and both write N+1 (instead of N+2). That's an acceptable cost — at
 * 60/min the ceiling is fuzzy by design. If a hardening pass ever
 * needs strict counts, swap the upsert for an atomic increment.
 */

import 'server-only';
import { prisma as db } from '@naap/database';

export interface RateLimitConfig {
  /** Max messages per minute. Defaults to 60. */
  perMinute: number;
  /** Max messages per UTC day. Defaults to 1000. */
  perDay: number;
}

export interface RateLimitResult {
  /** Whether this request is allowed through. */
  allowed: boolean;
  /** When denied, which window tripped — useful for the reply copy. */
  reason?: 'minute' | 'day';
  /** When denied, ms until the offending bucket resets. */
  retryAfterMs?: number;
}

const DEFAULT_PER_MINUTE = 60;
const DEFAULT_PER_DAY = 1000;

const MS_PER_MINUTE = 60_000;
const MS_PER_DAY = 86_400_000;

/**
 * Wire-format for the value column. Stored as JSON string so the
 * AbUserMemory.value text column stays generic.
 */
interface CounterState {
  /** Bucket index (epoch-minute or epoch-day). */
  bucket: number;
  /** Count of allowed requests inside `bucket`. */
  count: number;
}

function minuteBucket(now: number): number {
  return Math.floor(now / MS_PER_MINUTE);
}

function dayBucket(now: number): number {
  return Math.floor(now / MS_PER_DAY);
}

function readState(value: string | null | undefined): CounterState | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<CounterState>;
    if (
      typeof parsed.bucket === 'number' &&
      typeof parsed.count === 'number'
    ) {
      return { bucket: parsed.bucket, count: parsed.count };
    }
    return null;
  } catch {
    return null;
  }
}

async function loadCounter(
  tenantId: string,
  key: string,
): Promise<CounterState | null> {
  const row = await db.abUserMemory.findUnique({
    where: { tenantId_key: { tenantId, key } },
  });
  return readState(row?.value);
}

async function writeCounter(
  tenantId: string,
  key: string,
  state: CounterState,
): Promise<void> {
  const value = JSON.stringify(state);
  await db.abUserMemory.upsert({
    where: { tenantId_key: { tenantId, key } },
    update: { value, lastUsed: new Date() },
    // confidence=1 + type='rate_limit' marks these rows as
    // operational counters rather than learned preferences, so the
    // memory-decay logic in agent-memory.ts doesn't try to "forget"
    // them between sessions.
    create: { tenantId, key, value, type: 'rate_limit', confidence: 1 },
  });
}

/**
 * Check the per-tenant rate budget for `channel` and, if allowed,
 * increment the counters. Atomic at the bucket level — boundary
 * crossings reset cleanly.
 *
 * Order of checks: day first, then minute. The day window is the
 * harder ceiling (no quick recovery), so we surface that reason
 * preferentially for the reply copy.
 *
 * Tenant scope: every read and write here pins `tenantId`. A tenant
 * burning their budget can't affect any other tenant, by construction.
 */
export async function checkAndIncrement(
  tenantId: string,
  channel: string,
  config?: Partial<RateLimitConfig>,
): Promise<RateLimitResult> {
  const perMinute = config?.perMinute ?? DEFAULT_PER_MINUTE;
  const perDay = config?.perDay ?? DEFAULT_PER_DAY;

  const now = Date.now();
  const mBucket = minuteBucket(now);
  const dBucket = dayBucket(now);
  const minuteKey = `rate:${channel}:minute`;
  const dayKey = `rate:${channel}:day`;

  const [minuteState, dayState] = await Promise.all([
    loadCounter(tenantId, minuteKey),
    loadCounter(tenantId, dayKey),
  ]);

  // If we're in a new bucket, treat the count as zero — that's how the
  // window resets across boundaries.
  const minuteCount =
    minuteState && minuteState.bucket === mBucket ? minuteState.count : 0;
  const dayCount =
    dayState && dayState.bucket === dBucket ? dayState.count : 0;

  // Day ceiling first: harder limit, more specific reply copy.
  if (dayCount >= perDay) {
    const nextDayMs = (dBucket + 1) * MS_PER_DAY;
    return {
      allowed: false,
      reason: 'day',
      retryAfterMs: Math.max(0, nextDayMs - now),
    };
  }
  if (minuteCount >= perMinute) {
    const nextMinuteMs = (mBucket + 1) * MS_PER_MINUTE;
    return {
      allowed: false,
      reason: 'minute',
      retryAfterMs: Math.max(0, nextMinuteMs - now),
    };
  }

  // Allowed — bump both counters in their respective buckets.
  await Promise.all([
    writeCounter(tenantId, minuteKey, {
      bucket: mBucket,
      count: minuteCount + 1,
    }),
    writeCounter(tenantId, dayKey, {
      bucket: dBucket,
      count: dayCount + 1,
    }),
  ]);

  return { allowed: true };
}
