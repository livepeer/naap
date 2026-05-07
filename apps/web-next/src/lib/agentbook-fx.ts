/**
 * Multi-currency FX library (PR 13).
 *
 * Pipeline:
 *   1. Identity (from === to) → rate=1, no I/O.
 *   2. Cache hit (AbFxRate row for today's UTC date) → return cached.
 *   3. Cache miss → fetch frankfurter.app (ECB pass-through, no key) →
 *      upsert and return.
 *   4. Network failure → fall back to the most recent cached row of any
 *      date, regardless of how stale.
 *   5. No cache + no network → null. NEVER throws — currency conversion
 *      is a "best effort" path that callers must handle gracefully.
 *
 * Rates are stored at calendar-day granularity (`date` field is the UTC
 * midnight of the day) so that tenants in different timezones still
 * converge on a single canonical rate per pair per day.
 */

import 'server-only';
import { prisma as db } from '@naap/database';

export interface FxRate {
  from: string;
  to: string;
  rate: number;
  date: Date;
  source: 'ecb' | 'cached' | 'manual';
}

const CCY_RE = /^[A-Z]{3}$/;
const FRANKFURTER_BASE = 'https://api.frankfurter.app/latest';

/** UTC midnight for the given date (defaults to now). */
function utcMidnight(d: Date = new Date()): Date {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  return x;
}

/**
 * Fetch from frankfurter.app. Returns the rate or null on any failure
 * (HTTP error, JSON parse error, missing field). Never throws.
 */
async function fetchFrankfurter(from: string, to: string): Promise<number | null> {
  const url = `${FRANKFURTER_BASE}?from=${from}&to=${to}`;
  try {
    const res = await fetch(url);
    if (!res || !res.ok) return null;
    const data = (await res.json()) as { rates?: Record<string, number> };
    const rate = data?.rates?.[to];
    if (typeof rate !== 'number' || !isFinite(rate) || rate <= 0) return null;
    return rate;
  } catch {
    return null;
  }
}

/**
 * Get the FX rate between two ISO 4217 currency codes. See module-level
 * comment for the resolution order.
 */
export async function getRate(from: string, to: string, atDate?: Date): Promise<FxRate | null> {
  if (!from || !to || !CCY_RE.test(from) || !CCY_RE.test(to)) return null;
  if (from === to) {
    return { from, to, rate: 1, date: utcMidnight(atDate), source: 'manual' };
  }

  const date = utcMidnight(atDate);

  // 1) Cache hit for today.
  let cached: { rate: number; date: Date; source: string } | null = null;
  try {
    cached = (await db.abFxRate.findUnique({
      where: { fromCcy_toCcy_date: { fromCcy: from, toCcy: to, date } },
    })) as { rate: number; date: Date; source: string } | null;
  } catch {
    cached = null;
  }
  if (cached) {
    return { from, to, rate: cached.rate, date: cached.date, source: 'cached' };
  }

  // 2) Live fetch.
  const live = await fetchFrankfurter(from, to);
  if (live != null) {
    try {
      await db.abFxRate.upsert({
        where: { fromCcy_toCcy_date: { fromCcy: from, toCcy: to, date } },
        update: { rate: live, source: 'ecb' },
        create: { fromCcy: from, toCcy: to, date, rate: live, source: 'ecb' },
      });
    } catch {
      // Upsert is best-effort; even if it fails we still return the rate.
    }
    return { from, to, rate: live, date, source: 'ecb' };
  }

  // 3) Stale fallback — most recent prior cached row of any date.
  try {
    const prior = (await db.abFxRate.findFirst({
      where: { fromCcy: from, toCcy: to },
      orderBy: { date: 'desc' },
    })) as { rate: number; date: Date; source: string } | null;
    if (prior) {
      return { from, to, rate: prior.rate, date: prior.date, source: 'cached' };
    }
  } catch {
    // ignore
  }

  return null;
}

/**
 * Convert an amount in cents from one currency to another. Returns null
 * if no rate is available — caller decides how to surface to the user.
 */
export async function convertCents(
  amountCents: number,
  from: string,
  to: string,
  atDate?: Date,
): Promise<{ amountCents: number; rate: FxRate } | null> {
  if (!Number.isFinite(amountCents)) return null;
  if (from === to) {
    const rate: FxRate = { from, to, rate: 1, date: utcMidnight(atDate), source: 'manual' };
    return { amountCents: Math.round(amountCents), rate };
  }
  const rate = await getRate(from, to, atDate);
  if (!rate) return null;
  const converted = Math.round(amountCents * rate.rate);
  return { amountCents: converted, rate };
}
