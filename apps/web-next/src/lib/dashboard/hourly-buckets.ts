/**
 * Contiguous UTC hourly buckets for dashboard sparklines.
 *
 * The leaderboard returns one row per (window_start × gateway × pipeline …); hours
 * with no rows are omitted entirely. Plotting only "hours that appear" makes the
 * chart look sparse or like the "tail" is empty when those hours are missing.
 * We always emit exactly `timeframeHours` buckets ending at the latest hour seen
 * in the response (aligned with the API's rolling window).
 */

import type { NetworkDemandRow } from './raw-data.js';

const HOUR_MS = 60 * 60 * 1000;

/** Safety ceiling aligned with DASHBOARD_MAX_HOURS / facade KPI upper bound. */
const MAX_TIMEFRAME_HOURS = 168;

/** Normalize a leaderboard `window_start` to the UTC hour start (ms). */
export function utcHourStartMs(windowStart: string): number | null {
  const t = Date.parse(windowStart);
  if (Number.isNaN(t)) return null;
  return Math.floor(t / HOUR_MS) * HOUR_MS;
}

/** ISO string matching leaderboard style: `YYYY-MM-DDTHH:00:00Z`. */
export function formatWindowStartUtc(hourStartMs: number): string {
  const d = new Date(hourStartMs);
  const y = d.getUTCFullYear();
  const mo = String(d.getUTCMonth() + 1).padStart(2, '0');
  const da = String(d.getUTCDate()).padStart(2, '0');
  const h = String(d.getUTCHours()).padStart(2, '0');
  return `${y}-${mo}-${da}T${h}:00:00Z`;
}

export function buildContiguousDemandHourlyBuckets(
  rows: NetworkDemandRow[],
  timeframeHours: number,
  mode: 'minutes' | 'sessions'
): { hour: string; value: number }[] {
  const pick =
    mode === 'minutes'
      ? (r: NetworkDemandRow) => r.total_minutes ?? 0
      : (r: NetworkDemandRow) => r.total_demand_sessions ?? 0;

  const byHour = new Map<number, number>();
  for (const r of rows) {
    const h = utcHourStartMs(r.window_start);
    if (h == null) continue;
    const v = pick(r);
    byHour.set(h, (byHour.get(h) ?? 0) + v);
  }

  const hourStarts = [...byHour.keys()];
  const endMs =
    hourStarts.length > 0
      ? Math.max(...hourStarts)
      : Math.floor(Date.now() / HOUR_MS) * HOUR_MS;

  const safeHours = Number.isFinite(timeframeHours) ? timeframeHours : 24;
  const n = Math.max(1, Math.min(MAX_TIMEFRAME_HOURS, Math.floor(safeHours)));
  const buckets: { hour: string; value: number }[] = [];

  for (let i = 0; i < n; i++) {
    const hourMs = endMs - (n - 1 - i) * HOUR_MS;
    const raw = byHour.get(hourMs) ?? 0;
    const value = mode === 'minutes' ? Math.round(raw) : raw;
    buckets.push({ hour: formatWindowStartUtc(hourMs), value });
  }

  return buckets;
}
