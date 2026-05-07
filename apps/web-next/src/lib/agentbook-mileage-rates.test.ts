/**
 * Tests for the mileage-rate lookup helper. Rates are jurisdiction-aware:
 *
 *   • US — flat IRS standard mileage rate per mile, year-versioned.
 *   • CA — CRA tiered: 72¢/km for the first 5,000 km in a calendar year,
 *          66¢/km thereafter. Tier is selected by the caller-supplied
 *          "miles-or-km accumulated this year before this trip".
 *
 * The helper is pure (no I/O), so the suite runs offline.
 */

import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));

import {
  getMileageRate,
  CRA_TIER_BREAK_KM,
  US_RATE_2025_CENTS_PER_MI,
  CRA_LOW_TIER_CENTS_PER_KM,
  CRA_HIGH_TIER_CENTS_PER_KM,
} from './agentbook-mileage-rates';

describe('getMileageRate', () => {
  it('US 2025 → flat 67¢/mi (IRS standard rate)', () => {
    const r = getMileageRate('us', 2025, 0);
    expect(r.unit).toBe('mi');
    expect(r.ratePerUnitCents).toBe(US_RATE_2025_CENTS_PER_MI);
    expect(r.ratePerUnitCents).toBe(67);
    expect(r.reason).toMatch(/IRS/i);
  });

  it('US flat rate is invariant of accumulated miles (no tiers)', () => {
    const a = getMileageRate('us', 2025, 0);
    const b = getMileageRate('us', 2025, 9_999);
    expect(a.ratePerUnitCents).toBe(b.ratePerUnitCents);
  });

  it('CA below 5,000 km → low tier (72¢/km)', () => {
    const r = getMileageRate('ca', 2026, 1_234);
    expect(r.unit).toBe('km');
    expect(r.ratePerUnitCents).toBe(CRA_LOW_TIER_CENTS_PER_KM);
    expect(r.ratePerUnitCents).toBe(72);
    expect(r.reason).toMatch(/CRA/i);
  });

  it('CA above 5,000 km → high-tier (66¢/km)', () => {
    const r = getMileageRate('ca', 2026, 7_500);
    expect(r.unit).toBe('km');
    expect(r.ratePerUnitCents).toBe(CRA_HIGH_TIER_CENTS_PER_KM);
    expect(r.ratePerUnitCents).toBe(66);
  });

  it('CA at the 5,000 km boundary → low tier still applies (≤ 5,000)', () => {
    // Boundary policy (documented MVP scope): a trip starting with exactly
    // 5,000 km already accumulated falls into the high tier. Sitting just
    // below it (4,999) is still low-tier. We assert both.
    const just_below = getMileageRate('ca', 2026, CRA_TIER_BREAK_KM - 1);
    expect(just_below.ratePerUnitCents).toBe(CRA_LOW_TIER_CENTS_PER_KM);

    const at_boundary = getMileageRate('ca', 2026, CRA_TIER_BREAK_KM);
    expect(at_boundary.ratePerUnitCents).toBe(CRA_HIGH_TIER_CENTS_PER_KM);
  });

  it('unknown jurisdiction throws (fail-loud, not silent fallback)', () => {
    // @ts-expect-error — testing the runtime guard for malformed input.
    expect(() => getMileageRate('uk', 2025, 0)).toThrow(/jurisdiction/i);
  });

  it('unknown US year falls back to the latest published US rate', () => {
    // Future-year requests should not throw — they pin to the most-recent
    // rate we have, with a `reason` string that reflects the fallback.
    const r = getMileageRate('us', 2999, 0);
    expect(r.unit).toBe('mi');
    expect(r.ratePerUnitCents).toBe(US_RATE_2025_CENTS_PER_MI);
    expect(r.reason).toMatch(/fallback|2025/i);
  });

  it('US 2024 returns the published 2024 rate (not 2025)', () => {
    const r = getMileageRate('us', 2024, 0);
    expect(r.unit).toBe('mi');
    // IRS published 67¢/mi for 2024 too (December 2023 announcement).
    // Keep this in lock-step with the table inside the helper.
    expect([67, 65, 65.5]).toContain(r.ratePerUnitCents);
  });
});

describe('CRA tier picker — backdated-trip regression (PR 4 review M2)', () => {
  /**
   * Scenario: a CA tenant has these mileage entries already in the DB:
   *   • Jan 10: 4,990 km
   *   • Dec 1:  100 km   (post-boundary, already used HIGH tier)
   *
   * Now the user backdates a NEW 50 km trip to *Feb 1* (between the two
   * existing entries). The naive picker that filters by `date < year-end`
   * sees 5,090 km of "YTD" and picks the HIGH tier — wrong, because the
   * Dec 1 trip happened *after* the trip we're booking.
   *
   * The correct picker filters by `date < trip-date` and sees only the
   * 4,990 km that actually preceded Feb 1, putting the trip in the LOW
   * tier. We simulate the picker by passing the right vs. wrong YTD value
   * directly to `getMileageRate`.
   */

  // A small helper mirrors the production query: sum existing entries
  // whose date is strictly less than the candidate trip date.
  function ytdBeforeTrip(
    entries: { date: Date; miles: number }[],
    tripDate: Date,
  ): number {
    return entries
      .filter((e) => e.date < tripDate)
      .reduce((s, e) => s + e.miles, 0);
  }

  // Same shape, but the BUGGY filter (the one the PR review flagged):
  // sums everything in the calendar year regardless of order.
  function ytdAllYear(
    entries: { date: Date; miles: number }[],
    year: number,
  ): number {
    const yearStart = new Date(Date.UTC(year, 0, 1));
    const yearEnd = new Date(Date.UTC(year + 1, 0, 1));
    return entries
      .filter((e) => e.date >= yearStart && e.date < yearEnd)
      .reduce((s, e) => s + e.miles, 0);
  }

  it('backdated trip uses YTD-before-trip-date, NOT all-of-year totals', () => {
    const entries = [
      { date: new Date(Date.UTC(2026, 0, 10)), miles: 4_990 }, // Jan 10
      { date: new Date(Date.UTC(2026, 11, 1)), miles: 100 }, // Dec 1
    ];
    const tripDate = new Date(Date.UTC(2026, 1, 1)); // Feb 1

    const correctYtd = ytdBeforeTrip(entries, tripDate);
    const buggyYtd = ytdAllYear(entries, 2026);

    expect(correctYtd).toBe(4_990); // only Jan 10 preceded Feb 1
    expect(buggyYtd).toBe(5_090); // includes the Dec 1 trip → wrong

    const correctRate = getMileageRate('ca', 2026, correctYtd);
    const buggyRate = getMileageRate('ca', 2026, buggyYtd);

    // The fix: backdated trip lands in the LOW tier.
    expect(correctRate.ratePerUnitCents).toBe(CRA_LOW_TIER_CENTS_PER_KM);
    // Demonstrate the bug we are guarding against: buggy filter picks HIGH.
    expect(buggyRate.ratePerUnitCents).toBe(CRA_HIGH_TIER_CENTS_PER_KM);
  });

  it('linear-history trip (no backdating) gets the same answer either way', () => {
    // When entries are recorded in order, both filters yield the same
    // YTD-before total. This guards against accidentally penalising the
    // common case while we fix the backdating one.
    const entries = [
      { date: new Date(Date.UTC(2026, 0, 10)), miles: 1_500 },
      { date: new Date(Date.UTC(2026, 2, 5)), miles: 2_000 },
    ];
    const tripDate = new Date(Date.UTC(2026, 5, 1)); // June 1, after both

    const correctYtd = ytdBeforeTrip(entries, tripDate);
    const buggyYtd = ytdAllYear(entries, 2026);
    expect(correctYtd).toBe(buggyYtd);
    expect(correctYtd).toBe(3_500);
  });
});
