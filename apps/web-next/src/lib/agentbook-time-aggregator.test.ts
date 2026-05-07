/**
 * Unit tests for the time-aggregation helpers used by the timer →
 * invoice flow. Both helpers are pure, so the suite runs offline.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  parseDateHint,
  aggregateByDay,
  type TimeEntryRow,
} from './agentbook-time-aggregator';

describe('aggregateByDay', () => {
  it('returns [] for empty input', () => {
    expect(aggregateByDay([])).toEqual([]);
  });

  it('produces one line for a single entry, hours rounded to 0.25', () => {
    const entries: TimeEntryRow[] = [
      { id: 'a', date: '2026-05-01', description: 'planning', durationMinutes: 80, hourlyRateCents: 15000 },
    ];
    const lines = aggregateByDay(entries);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      description: '2026-05-01 — planning',
      // 80 / 60 = 1.333… → rounded to 1.25 (nearest 0.25)
      quantity: 1.25,
      rateCents: 15000,
      minutes: 80,
      entryIds: ['a'],
    });
  });

  it('aggregates two entries on the same day with the same description', () => {
    const entries: TimeEntryRow[] = [
      { id: 'a', date: '2026-05-01', description: 'planning', durationMinutes: 60, hourlyRateCents: 15000 },
      { id: 'b', date: '2026-05-01', description: 'planning', durationMinutes: 90, hourlyRateCents: 15000 },
    ];
    const lines = aggregateByDay(entries);
    expect(lines).toHaveLength(1);
    expect(lines[0].description).toBe('2026-05-01 — planning');
    expect(lines[0].minutes).toBe(150);
    expect(lines[0].quantity).toBe(2.5);
    expect(lines[0].rateCents).toBe(15000);
    expect(lines[0].entryIds).toEqual(['a', 'b']);
  });

  it('produces two lines for two entries on different days', () => {
    const entries: TimeEntryRow[] = [
      { id: 'a', date: '2026-05-01', description: 'planning', durationMinutes: 60, hourlyRateCents: 15000 },
      { id: 'b', date: '2026-05-02', description: 'design',   durationMinutes: 120, hourlyRateCents: 15000 },
    ];
    const lines = aggregateByDay(entries);
    expect(lines).toHaveLength(2);
    expect(lines.map((l) => l.description)).toEqual([
      '2026-05-01 — planning',
      '2026-05-02 — design',
    ]);
    expect(lines.map((l) => l.minutes)).toEqual([60, 120]);
  });

  it('uses a weighted-mean rate when entries on the same day have mixed rates', () => {
    const entries: TimeEntryRow[] = [
      // 60 min @ $100/hr (10000¢)
      { id: 'a', date: '2026-05-01', description: 'consult', durationMinutes: 60, hourlyRateCents: 10000 },
      // 60 min @ $200/hr (20000¢)
      { id: 'b', date: '2026-05-01', description: 'consult', durationMinutes: 60, hourlyRateCents: 20000 },
    ];
    const lines = aggregateByDay(entries);
    expect(lines).toHaveLength(1);
    // Weighted by minutes — equal weights → simple mean: (10000 + 20000) / 2 = 15000.
    expect(lines[0].rateCents).toBe(15000);
    expect(lines[0].minutes).toBe(120);
  });

  it('weights the mean by minutes when contributions are uneven', () => {
    const entries: TimeEntryRow[] = [
      // 30 min @ $100/hr — weight 30
      { id: 'a', date: '2026-05-01', description: 'consult', durationMinutes: 30, hourlyRateCents: 10000 },
      // 90 min @ $200/hr — weight 90
      { id: 'b', date: '2026-05-01', description: 'consult', durationMinutes: 90, hourlyRateCents: 20000 },
    ];
    const lines = aggregateByDay(entries);
    // Weighted mean: (30*10000 + 90*20000) / 120 = 17500.
    expect(lines[0].rateCents).toBe(17500);
  });

  it('returns rate 0 when all entries on a day have null rates (aggregator is pure — consumer rejects $0 invoices)', () => {
    // Invariant: the aggregator stays a pure projection. Producing
    // `rateCents: 0` here is *correct* (no rate data, no rate). The
    // rejection of zero-rate drafts lives in the consumers (the
    // `from-time-entries` route + the bot agent's `invoice.from_timer`
    // step), so they can return a fixable user-facing error instead of
    // silently creating a $0 draft.
    const entries: TimeEntryRow[] = [
      { id: 'a', date: '2026-05-01', description: 'misc', durationMinutes: 60, hourlyRateCents: null },
      { id: 'b', date: '2026-05-01', description: 'misc', durationMinutes: 60, hourlyRateCents: null },
    ];
    const lines = aggregateByDay(entries);
    expect(lines[0].rateCents).toBe(0);
    // Document the consumer expectation: every line is 0¢, so a
    // downstream `lines.every(l => l.rateCents === 0)` guard fires.
    expect(lines.every((l) => l.rateCents === 0)).toBe(true);
  });

  it('falls back to "multiple tasks" when descriptions on a day differ', () => {
    const entries: TimeEntryRow[] = [
      { id: 'a', date: '2026-05-01', description: 'planning', durationMinutes: 60, hourlyRateCents: 15000 },
      { id: 'b', date: '2026-05-01', description: 'design',   durationMinutes: 60, hourlyRateCents: 15000 },
    ];
    const lines = aggregateByDay(entries);
    expect(lines[0].description).toBe('2026-05-01 — multiple tasks');
  });
});

describe('parseDateHint', () => {
  it('defaults to "this month" when hint is undefined', () => {
    const r = parseDateHint(undefined, 'UTC');
    const now = new Date();
    expect(r.startDate.getUTCDate()).toBe(1);
    expect(r.startDate.getUTCMonth()).toBe(now.getUTCMonth());
    expect(r.startDate.getUTCFullYear()).toBe(now.getUTCFullYear());
    // endDate is the start of next month → strictly after startDate.
    expect(r.endDate.getTime()).toBeGreaterThan(r.startDate.getTime());
  });

  it('"this month" returns first-of-month → first-of-next-month boundaries (UTC)', () => {
    const r = parseDateHint('this month', 'UTC');
    expect(r.startDate.getUTCDate()).toBe(1);
    expect(r.endDate.getUTCDate()).toBe(1);
    // The two boundaries are 28-31 days apart.
    const days = (r.endDate.getTime() - r.startDate.getTime()) / 86400000;
    expect(days).toBeGreaterThanOrEqual(28);
    expect(days).toBeLessThanOrEqual(31);
  });

  it('"last month" returns the previous calendar month', () => {
    const r = parseDateHint('last month', 'UTC');
    const thisMonth = parseDateHint('this month', 'UTC');
    // The end of "last month" === the start of "this month".
    expect(r.endDate.getTime()).toBe(thisMonth.startDate.getTime());
    expect(r.startDate.getUTCDate()).toBe(1);
  });

  it('"this week" spans 7 days starting Monday', () => {
    const r = parseDateHint('this week', 'UTC');
    const days = (r.endDate.getTime() - r.startDate.getTime()) / 86400000;
    expect(Math.round(days)).toBe(7);
    // Monday-based: getUTCDay() === 1 for Monday. (0 === Sunday)
    expect(r.startDate.getUTCDay()).toBe(1);
  });

  it('"last week" ends where "this week" begins', () => {
    const thisWeek = parseDateHint('this week', 'UTC');
    const lastWeek = parseDateHint('last week', 'UTC');
    expect(lastWeek.endDate.getTime()).toBe(thisWeek.startDate.getTime());
    const days = (lastWeek.endDate.getTime() - lastWeek.startDate.getTime()) / 86400000;
    expect(Math.round(days)).toBe(7);
  });

  it('unknown hint falls back to "this month"', () => {
    const fallback = parseDateHint('this lifetime', 'UTC');
    const thisMonth = parseDateHint('this month', 'UTC');
    expect(fallback.startDate.getTime()).toBe(thisMonth.startDate.getTime());
    expect(fallback.endDate.getTime()).toBe(thisMonth.endDate.getTime());
  });

  it('respects the tenant timezone for "this month" boundaries', () => {
    // Pacific is UTC-8 (or -7 with DST); the start-of-month instant in
    // local time should be later than the corresponding UTC instant.
    const utc = parseDateHint('this month', 'UTC');
    const pacific = parseDateHint('this month', 'America/Los_Angeles');
    // Pacific midnight = UTC midnight + 7-8 hours, so the .getTime() is
    // strictly greater (or, on the rare day the local "this month"
    // straddles into a different UTC month, exactly different — but
    // never identical to the UTC anchor on most days).
    expect(pacific.startDate.getTime()).not.toBe(utc.startDate.getTime());
  });

  describe('year-edge and DST', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it('"last week" anchored on Jan 3 spans the previous year (Dec into Jan)', () => {
      // Jan 3, 2026 is a Saturday in America/New_York. "this week" runs
      // Mon Dec 29 → Mon Jan 5, so "last week" is Mon Dec 22 → Mon Dec 29
      // — both boundaries land in 2025. Verifies the math survives the
      // year roll without truncating to month/year separately.
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-01-03T15:00:00Z'));
      const r = parseDateHint('last week', 'America/New_York');
      const days = (r.endDate.getTime() - r.startDate.getTime()) / 86400000;
      // 7 days, possibly off by 1/24 if a DST crossover landed inside
      // (none in late Dec/early Jan, but be defensive).
      expect(Math.round(days)).toBe(7);
      expect(r.startDate.getUTCFullYear()).toBe(2025);
      expect(r.startDate.getUTCMonth()).toBe(11); // December (0-indexed)
      expect(r.endDate.getUTCFullYear()).toBe(2025);
      expect(r.endDate.getUTCMonth()).toBe(11);
    });

    it('"today" on a DST spring-forward day yields a 23-hour range, not 25', () => {
      // 2026-03-08 is the second Sunday of March — US spring-forward,
      // when 02:00 jumps to 03:00 in America/New_York. The local day is
      // 23 hours wide. The naive `+86_400_000` math would over-shoot.
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-03-08T15:00:00Z'));
      const r = parseDateHint('today', 'America/New_York');
      const hours = (r.endDate.getTime() - r.startDate.getTime()) / 3_600_000;
      expect(hours).toBe(23);
    });

    it('"today" on a non-DST day is exactly 24 hours wide', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-05-06T15:00:00Z'));
      const r = parseDateHint('today', 'America/New_York');
      const hours = (r.endDate.getTime() - r.startDate.getTime()) / 3_600_000;
      expect(hours).toBe(24);
    });

    it('"today" on a fall-back day yields a 25-hour range', () => {
      // 2026-11-01 is the first Sunday of November — fall-back, the
      // local day is 25 hours wide.
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-11-01T15:00:00Z'));
      const r = parseDateHint('today', 'America/New_York');
      const hours = (r.endDate.getTime() - r.startDate.getTime()) / 3_600_000;
      expect(hours).toBe(25);
    });
  });
});
