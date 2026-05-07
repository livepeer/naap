/**
 * Pure helpers for the timer → invoice flow (PR 2).
 *
 * `parseDateHint` resolves natural-language ranges ("this week", "last
 * month", …) into concrete `[start, end)` boundaries, anchored to the
 * tenant's timezone when supplied (default UTC). The half-open shape
 * matches Prisma's `gte`/`lt` filter and avoids the off-by-one boundary
 * trap when an entry's `startedAt` lands exactly at midnight on the
 * range edge.
 *
 * `aggregateByDay` groups time entries by calendar day, summing
 * minutes, computing weighted-mean rates (so mixing $150/hr and $200/hr
 * entries on the same day yields a true blended rate, not a misleading
 * arithmetic average), and rounding to the nearest 0.25 hour for
 * invoice cleanliness.
 *
 * Both helpers are pure / side-effect-free so they can be unit-tested
 * without spinning up a database.
 */

export interface TimeRange {
  startDate: Date;
  endDate: Date;
}

export interface TimeEntryRow {
  id: string;
  date: string; // ISO date (YYYY-MM-DD) — caller normalises in the tenant TZ
  description: string;
  durationMinutes: number;
  hourlyRateCents: number | null;
}

export interface AggregatedLine {
  description: string;
  quantity: number;     // hours, rounded to 0.25
  rateCents: number;    // weighted-mean rate (or 0 if all rates null)
  minutes: number;      // sum of underlying minutes (for audit)
  entryIds: string[];
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Convert a Date to a YYYY-MM-DD string in the given IANA timezone.
 * Falls back to UTC if the timezone is invalid or `Intl.DateTimeFormat`
 * doesn't support it on this runtime.
 */
function isoDateInTz(date: Date, tz: string): string {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(date);
    const y = parts.find((p) => p.type === 'year')?.value;
    const m = parts.find((p) => p.type === 'month')?.value;
    const d = parts.find((p) => p.type === 'day')?.value;
    if (y && m && d) return `${y}-${m}-${d}`;
  } catch {
    /* fall through */
  }
  return date.toISOString().slice(0, 10);
}

/**
 * Build a Date from year/month/day at midnight in the given IANA
 * timezone. Uses an iterative correction (UTC anchor → measure offset →
 * adjust) which is cheap and survives DST without pulling in moment / luxon.
 *
 * Exported so callers (e.g. the bot agent's `timer.status` path) can
 * compute "today's midnight" in the tenant TZ without recreating the
 * offset-walking logic.
 */
export function midnightInTz(year: number, month0: number, day: number, tz: string): Date {
  const utc = Date.UTC(year, month0, day, 0, 0, 0, 0);
  const guess = new Date(utc);
  const offsetMin = (() => {
    try {
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: tz,
        hour12: false,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      }).formatToParts(guess);
      const map: Record<string, string> = {};
      for (const p of parts) map[p.type] = p.value;
      const asLocalUtc = Date.UTC(
        Number(map.year),
        Number(map.month) - 1,
        Number(map.day),
        Number(map.hour) === 24 ? 0 : Number(map.hour),
        Number(map.minute),
        Number(map.second),
      );
      return (asLocalUtc - utc) / 60000;
    } catch {
      return 0;
    }
  })();
  return new Date(utc - offsetMin * 60000);
}

/**
 * Resolve a natural-language hint to a `[startDate, endDate)` range in
 * the tenant timezone (default UTC).
 *
 * Hints recognised: "today", "this week", "last week", "this month",
 * "last month". "Week" boundaries use Monday as week-start (ISO 8601).
 * Falls back to "this month" when the hint is undefined or unrecognised.
 *
 * "today" returns `[localMidnight, nextLocalMidnight)`. Width is computed
 * by calendar-day arithmetic (not `+ 86_400_000`), so DST spring-forward
 * yields a 23-hour day and fall-back yields 25 hours — never an off-by-one.
 */
export function parseDateHint(hint: string | undefined, tz: string = 'UTC'): TimeRange {
  const now = new Date();
  const todayIso = isoDateInTz(now, tz);
  const [yStr, mStr, dStr] = todayIso.split('-');
  const y = Number(yStr);
  const m0 = Number(mStr) - 1;
  const d = Number(dStr);

  const normalised = (hint || '').trim().toLowerCase();

  // Day-of-week computed in the tenant TZ (the local day, not UTC's).
  const localMidnight = midnightInTz(y, m0, d, tz);
  // 0 (Sun) – 6 (Sat). Convert to Monday-based: Mon=0, …, Sun=6.
  const dow = localMidnight.getUTCDay();
  const mondayOffset = (dow + 6) % 7;

  if (normalised === 'today') {
    // Walk to *tomorrow's* midnight via calendar day-of-month, not
    // raw +24h: that survives DST transitions where today is 23 or
    // 25 hours long in the local zone.
    const startDate = localMidnight;
    const endDate = midnightInTz(y, m0, d + 1, tz);
    return { startDate, endDate };
  }

  if (normalised === 'this week') {
    const startDate = new Date(localMidnight.getTime() - mondayOffset * MS_PER_DAY);
    const endDate = new Date(startDate.getTime() + 7 * MS_PER_DAY);
    return { startDate, endDate };
  }

  if (normalised === 'last week') {
    const thisWeekStart = new Date(localMidnight.getTime() - mondayOffset * MS_PER_DAY);
    const startDate = new Date(thisWeekStart.getTime() - 7 * MS_PER_DAY);
    const endDate = thisWeekStart;
    return { startDate, endDate };
  }

  if (normalised === 'last month') {
    const startMonth0 = m0 === 0 ? 11 : m0 - 1;
    const startYear = m0 === 0 ? y - 1 : y;
    const startDate = midnightInTz(startYear, startMonth0, 1, tz);
    const endDate = midnightInTz(y, m0, 1, tz);
    return { startDate, endDate };
  }

  // Default and explicit "this month".
  const startDate = midnightInTz(y, m0, 1, tz);
  const nextMonth0 = m0 === 11 ? 0 : m0 + 1;
  const nextYear = m0 === 11 ? y + 1 : y;
  const endDate = midnightInTz(nextYear, nextMonth0, 1, tz);
  return { startDate, endDate };
}

/** Round a positive number to the nearest 0.25 (with a minimum of 0.25). */
function roundQuarter(hours: number): number {
  if (hours <= 0) return 0;
  const rounded = Math.round(hours * 4) / 4;
  return rounded < 0.25 ? 0.25 : rounded;
}

/**
 * Group entries by their `date` field (already normalised to a YYYY-MM-DD
 * string in the tenant TZ by the caller) and produce one invoice line
 * per day.
 *
 * Per-day:
 *   • description    — "{date} — {desc}" if all entries share the same
 *                      description, otherwise "{date} — multiple tasks".
 *   • quantity       — total hours rounded to 0.25 (minimum 0.25 if any
 *                      minutes > 0).
 *   • rateCents      — weighted-mean of non-null rates, weighted by
 *                      minutes. 0 if all rates are null on that day.
 *   • minutes        — raw sum (preserved for audit / round-trip).
 *   • entryIds       — IDs of every contributing entry, ordered as input.
 */
export function aggregateByDay(entries: TimeEntryRow[]): AggregatedLine[] {
  if (entries.length === 0) return [];

  const groups = new Map<string, TimeEntryRow[]>();
  for (const e of entries) {
    const list = groups.get(e.date);
    if (list) list.push(e);
    else groups.set(e.date, [e]);
  }

  const sortedDates = Array.from(groups.keys()).sort();
  const out: AggregatedLine[] = [];

  for (const date of sortedDates) {
    const list = groups.get(date)!;
    const totalMinutes = list.reduce((s, e) => s + Math.max(0, e.durationMinutes || 0), 0);

    let weightedRateNumer = 0;
    let weightedRateDenom = 0;
    for (const e of list) {
      if (e.hourlyRateCents != null && e.durationMinutes > 0) {
        weightedRateNumer += e.hourlyRateCents * e.durationMinutes;
        weightedRateDenom += e.durationMinutes;
      }
    }
    const rateCents = weightedRateDenom > 0
      ? Math.round(weightedRateNumer / weightedRateDenom)
      : 0;

    const descriptions = new Set(list.map((e) => (e.description || '').trim()).filter(Boolean));
    let description: string;
    if (descriptions.size === 0) {
      description = date;
    } else if (descriptions.size === 1) {
      description = `${date} — ${Array.from(descriptions)[0]}`;
    } else {
      description = `${date} — multiple tasks`;
    }

    out.push({
      description,
      quantity: roundQuarter(totalMinutes / 60),
      rateCents,
      minutes: totalMinutes,
      entryIds: list.map((e) => e.id),
    });
  }

  return out;
}
