/**
 * Mileage-rate lookup. Pure helper — no DB, no network.
 *
 * Sources:
 *   • US (IRS) — 67¢ per business mile for tax year 2025; 67¢ for 2024
 *     (IRS Notice 2024-08, published Dec 2023). The 2025 rate is the
 *     IRS-announced standard mileage rate (67¢/mi business use). One flat
 *     rate, no tiers.
 *   • CA (CRA) — automobile allowance rates. For 2026 (carrying forward
 *     2025's published table until CRA updates), the deductible per-km
 *     rate is 72¢/km for the first 5,000 km driven for business in the
 *     calendar year, and 66¢/km thereafter (extra 4¢/km in NT, NU, YT,
 *     not modelled — that's PR 5+ scope).
 *
 * Boundary policy (MVP):
 *   We do NOT split a single trip across the 5,000 km boundary; whichever
 *   tier the cumulative-YTD-before-this-trip lands in is what the entire
 *   trip uses. The simpler rule keeps the journal entry single-line and
 *   reversible. Mid-trip splits land in a follow-up.
 *
 *   Worked example:
 *     Maya is at 4,990 km YTD (Canada tenant) and logs a 50 km trip.
 *     YTD-before-trip = 4,990 km is < 5,000 → LOW tier picked. The entry
 *     uses 72¢/km × 50 km = $36.00 for the entire trip, even though
 *     10 km of it technically crosses the 5,000 km boundary into the
 *     high-tier bucket. After this entry, YTD = 5,040 km, so her *next*
 *     trip will be billed at the HIGH tier (66¢/km).
 */

import 'server-only';

export const US_RATE_2025_CENTS_PER_MI = 67;
export const US_RATE_2024_CENTS_PER_MI = 67;

export const CRA_TIER_BREAK_KM = 5_000;
export const CRA_LOW_TIER_CENTS_PER_KM = 72;
export const CRA_HIGH_TIER_CENTS_PER_KM = 66;

export interface RateLookup {
  ratePerUnitCents: number;
  unit: 'mi' | 'km';
  reason: string;
}

/**
 * Resolve the per-unit deductible mileage rate for a given trip.
 *
 * @param jurisdiction `'us'` (mile-based, flat) or `'ca'` (km-based, tiered).
 * @param year         calendar year of the trip (used for US rate lookup).
 * @param milesOrKmThisYear
 *   total miles (US) or km (CA) the user has already accumulated **this
 *   calendar year** before this trip. Drives CRA tier selection; ignored
 *   for US. Pass `0` if this is the first trip of the year.
 *
 * @returns rate in cents per unit, the unit (`mi` or `km`), and a short
 *   `reason` string suitable for memo lines / audit logs.
 *
 * Throws if `jurisdiction` is anything other than `'us'` / `'ca'`.
 */
export function getMileageRate(
  jurisdiction: 'us' | 'ca',
  year: number,
  milesOrKmThisYear: number,
): RateLookup {
  if (jurisdiction === 'us') {
    if (year === 2025) {
      return {
        ratePerUnitCents: US_RATE_2025_CENTS_PER_MI,
        unit: 'mi',
        reason: 'IRS standard mileage rate, 2025 (67¢/mi)',
      };
    }
    if (year === 2024) {
      return {
        ratePerUnitCents: US_RATE_2024_CENTS_PER_MI,
        unit: 'mi',
        reason: 'IRS standard mileage rate, 2024 (67¢/mi)',
      };
    }
    // Unknown year — pin to the most-recent rate we publish. Fail
    // forward, not loud, so a January-1st trip booked before we update
    // the table doesn't reject the user's entry.
    return {
      ratePerUnitCents: US_RATE_2025_CENTS_PER_MI,
      unit: 'mi',
      reason: `IRS standard mileage rate, fallback to 2025 rate (year=${year})`,
    };
  }

  if (jurisdiction === 'ca') {
    // Tier selection uses STRICT-less-than against the break: someone
    // standing at exactly 5,000 km YTD has fully consumed the low-tier
    // bucket and starts the next trip in the high tier.
    if (milesOrKmThisYear < CRA_TIER_BREAK_KM) {
      return {
        ratePerUnitCents: CRA_LOW_TIER_CENTS_PER_KM,
        unit: 'km',
        reason: `CRA reasonable per-km rate, first ${CRA_TIER_BREAK_KM.toLocaleString('en-CA')} km tier (72¢/km)`,
      };
    }
    return {
      ratePerUnitCents: CRA_HIGH_TIER_CENTS_PER_KM,
      unit: 'km',
      reason: `CRA reasonable per-km rate, after ${CRA_TIER_BREAK_KM.toLocaleString('en-CA')} km (66¢/km)`,
    };
  }

  throw new Error(
    `Unknown jurisdiction "${jurisdiction}" — supported: 'us' | 'ca'`,
  );
}
