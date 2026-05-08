/**
 * Home-office deductible math (PR 15). Pure helper — no DB, no network.
 *
 * Two flavours:
 *
 *   • US "simplified method" (IRS Pub 587). Flat $5/sqft up to 300 sqft,
 *     so the annual cap is $1,500. We pro-rate to a single quarter by
 *     dividing the annual figure by 4. The actual utilities/rent the
 *     user typed are *ignored* under this method — the IRS gives you
 *     the flat rate or the actual-expense method, never both.
 *
 *   • Actual-expense method (default for CA, optional for US tenants
 *     who don't tick "use simplified"). Sum the quarter's eligible
 *     overhead (utilities + internet + rent/mortgage interest +
 *     insurance + other) and apply the office-square-footage ratio
 *     (officeSqft ÷ totalSqft).
 *
 * All amounts are expressed in cents to match the rest of AgentBook;
 * callers convert to/from dollars at the boundary.
 */

import 'server-only';

/** $5.00/sqft per IRS Pub 587 simplified method. */
export const US_SIMPLIFIED_RATE_PER_SQFT_CENTS = 500;
/** 300 sqft hard cap on simplified-method square footage. */
export const US_SIMPLIFIED_MAX_SQFT = 300;
/** Annual cap = 300 sqft × $5 = $1,500 = 150,000 cents. */
export const US_SIMPLIFIED_ANNUAL_CAP_CENTS =
  US_SIMPLIFIED_RATE_PER_SQFT_CENTS * US_SIMPLIFIED_MAX_SQFT;

/**
 * Compute the office:total square-footage ratio. Defensive against
 * missing / zero / negative inputs (returns 0) and a misconfigured
 * officeSqft > totalSqft (clamps to 1.0). The form should reject the
 * latter at write-time, but the helper still provides a safe upper
 * bound in case bad data sneaks in.
 */
export function computeRatio(
  totalSqft: number | null | undefined,
  officeSqft: number | null | undefined,
): number {
  const t = typeof totalSqft === 'number' ? totalSqft : 0;
  const o = typeof officeSqft === 'number' ? officeSqft : 0;
  if (!isFinite(t) || !isFinite(o) || t <= 0 || o <= 0) return 0;
  if (o >= t) return 1;
  return o / t;
}

export interface QuarterlyDeductibleInput {
  mode: 'actual' | 'us_simplified';
  /**
   * Pre-computed office:total ratio. Required for `mode='actual'`,
   * ignored for `mode='us_simplified'`.
   */
  ratio?: number;
  /**
   * Configured office square footage (only consulted by
   * `mode='us_simplified'` for the flat-rate calc).
   */
  officeSqft?: number;
  utilitiesCents?: number;
  internetCents?: number;
  rentInterestCents?: number;
  insuranceCents?: number;
  otherCents?: number;
}

export interface QuarterlyDeductibleResult {
  /** Echo of the input mode so callers don't have to track it. */
  mode: 'actual' | 'us_simplified';
  /** Sum of the four/five component totals (only meaningful for `actual`). */
  totalQuarterCents: number;
  /** The deductible portion in cents. Always ≥ 0. */
  deductibleCents: number;
}

/**
 * Compute the deductible portion of a quarter's home-office overhead
 * given either:
 *   • US simplified flat rate (200 sqft × $5 ÷ 4 quarters = $250), or
 *   • actual ratio × sum-of-totals.
 *
 * Returns cents (rounded to the nearest cent for the actual-expense
 * path; integer arithmetic for the simplified path so it's exact).
 */
export function computeQuarterlyDeductible(
  input: QuarterlyDeductibleInput,
): QuarterlyDeductibleResult {
  const utilities = nz(input.utilitiesCents);
  const internet = nz(input.internetCents);
  const rentInterest = nz(input.rentInterestCents);
  const insurance = nz(input.insuranceCents);
  const other = nz(input.otherCents);
  const totalQuarterCents = utilities + internet + rentInterest + insurance + other;

  if (input.mode === 'us_simplified') {
    const sqft = nz(input.officeSqft);
    if (sqft <= 0) {
      return { mode: 'us_simplified', totalQuarterCents, deductibleCents: 0 };
    }
    const cappedSqft = Math.min(sqft, US_SIMPLIFIED_MAX_SQFT);
    const annualCents = cappedSqft * US_SIMPLIFIED_RATE_PER_SQFT_CENTS;
    // Quarterly = annual / 4. Always divides evenly because the rate
    // (500¢) and 4 quarters work out cleanly for any integer sqft.
    const quarterlyCents = Math.round(annualCents / 4);
    return {
      mode: 'us_simplified',
      totalQuarterCents,
      deductibleCents: quarterlyCents,
    };
  }

  const ratio = typeof input.ratio === 'number' && isFinite(input.ratio) && input.ratio > 0
    ? Math.min(input.ratio, 1)
    : 0;
  const deductibleCents = Math.round(totalQuarterCents * ratio);
  return { mode: 'actual', totalQuarterCents, deductibleCents };
}

/** Coerce a possibly-undefined / non-positive number to a non-negative integer. */
function nz(v: number | null | undefined): number {
  if (typeof v !== 'number' || !isFinite(v) || v <= 0) return 0;
  return v;
}
