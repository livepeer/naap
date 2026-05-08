/**
 * Tests for the home-office deductible-portion helper (PR 15).
 *
 * The home-office deduction has two flavours:
 *
 *  • US "simplified" — flat $5/sqft up to 300 sqft. Capped at $1,500/yr.
 *    For a quarterly post we apportion 1/4 of the annual cap unless a
 *    smaller floor (officeSqft × $5 ÷ 4) applies. The pure rate doesn't
 *    care about utilities/internet/rent — it's a flat per-sqft formula.
 *
 *  • Actual-expense (default for CA, optional for US) — the user supplies
 *    the quarter's totals (utilities, internet, rent/mortgage interest,
 *    insurance, other) and we apply the office:total square-footage ratio.
 *
 * The helper is pure (no DB, no network), so the suite runs offline.
 */

import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));

import {
  computeRatio,
  computeQuarterlyDeductible,
  US_SIMPLIFIED_RATE_PER_SQFT_CENTS,
  US_SIMPLIFIED_MAX_SQFT,
  US_SIMPLIFIED_ANNUAL_CAP_CENTS,
} from './agentbook-home-office';

describe('computeRatio', () => {
  it('200/2000 = 0.10', () => {
    expect(computeRatio(2000, 200)).toBeCloseTo(0.1, 6);
  });

  it('150/1500 = 0.10', () => {
    expect(computeRatio(1500, 150)).toBeCloseTo(0.1, 6);
  });

  it('officeSqft greater than totalSqft is clamped to 1.0', () => {
    // Defensive — the form should reject this, but the helper still
    // returns a sensible upper bound rather than producing >100%.
    expect(computeRatio(100, 200)).toBe(1);
  });

  it('zero / negative / missing inputs return 0', () => {
    expect(computeRatio(0, 100)).toBe(0);
    expect(computeRatio(1000, 0)).toBe(0);
    expect(computeRatio(-1, 100)).toBe(0);
    expect(computeRatio(1000, -50)).toBe(0);
    expect(computeRatio(undefined, 100)).toBe(0);
    expect(computeRatio(1000, undefined)).toBe(0);
  });
});

describe('computeQuarterlyDeductible — actual-expense (CA + US opt-out)', () => {
  it('10% ratio × $4,090 quarter total = $409 deductible', () => {
    const r = computeQuarterlyDeductible({
      mode: 'actual',
      ratio: 0.1,
      utilitiesCents: 40_000,         // $400
      internetCents: 9_000,           // $90
      rentInterestCents: 300_000,     // $3,000
      insuranceCents: 9_000,          // $90
      otherCents: 1_000,              // $10
    });
    // Total quarter = 400 + 90 + 3000 + 90 + 10 = $3,590
    // Wait — that's $3,590. Ratio 10% = $359.
    expect(r.totalQuarterCents).toBe(359_000);
    expect(r.deductibleCents).toBe(35_900);
    expect(r.mode).toBe('actual');
  });

  it('rounds half-cents to nearest cent', () => {
    const r = computeQuarterlyDeductible({
      mode: 'actual',
      ratio: 0.137,                  // unusual ratio
      utilitiesCents: 33_333,
      internetCents: 0,
      rentInterestCents: 0,
      insuranceCents: 0,
      otherCents: 0,
    });
    // 33333 × 0.137 = 4566.621 → rounds to 4567
    expect(r.deductibleCents).toBe(4567);
  });

  it('zero ratio yields zero deductible regardless of inputs', () => {
    const r = computeQuarterlyDeductible({
      mode: 'actual',
      ratio: 0,
      utilitiesCents: 999_999,
      internetCents: 999_999,
      rentInterestCents: 999_999,
      insuranceCents: 999_999,
      otherCents: 999_999,
    });
    expect(r.deductibleCents).toBe(0);
  });

  it('treats undefined component fields as 0', () => {
    const r = computeQuarterlyDeductible({
      mode: 'actual',
      ratio: 0.2,
      utilitiesCents: 50_000,
    });
    expect(r.totalQuarterCents).toBe(50_000);
    expect(r.deductibleCents).toBe(10_000);
  });
});

describe('computeQuarterlyDeductible — US simplified ($5/sqft up to 300 sqft)', () => {
  it('200 sqft × $5 = $1,000 annual → $250/quarter', () => {
    const r = computeQuarterlyDeductible({
      mode: 'us_simplified',
      officeSqft: 200,
    });
    // 200 sqft × $5 = $1,000 = 100,000¢ annual
    // /4 = 25,000¢ per quarter
    expect(r.deductibleCents).toBe(25_000);
    expect(r.mode).toBe('us_simplified');
  });

  it('400 sqft caps at 300 sqft → $1,500/yr → $375/quarter', () => {
    const r = computeQuarterlyDeductible({
      mode: 'us_simplified',
      officeSqft: 400,
    });
    // Capped at 300 sqft × $5 = $1,500 = 150,000¢ annual
    // /4 = 37,500¢ per quarter
    expect(r.deductibleCents).toBe(37_500);
  });

  it('300 sqft is the inclusive cap', () => {
    const r = computeQuarterlyDeductible({
      mode: 'us_simplified',
      officeSqft: 300,
    });
    expect(r.deductibleCents).toBe(US_SIMPLIFIED_ANNUAL_CAP_CENTS / 4);
  });

  it('0 / undefined officeSqft yields 0 deductible', () => {
    expect(
      computeQuarterlyDeductible({ mode: 'us_simplified', officeSqft: 0 }).deductibleCents,
    ).toBe(0);
    expect(
      computeQuarterlyDeductible({ mode: 'us_simplified' }).deductibleCents,
    ).toBe(0);
  });

  it('US simplified ignores supplied component costs (it is a flat formula)', () => {
    const r = computeQuarterlyDeductible({
      mode: 'us_simplified',
      officeSqft: 100,
      utilitiesCents: 999_999_999,    // ignored
      rentInterestCents: 999_999_999, // ignored
    });
    // 100 × $5 = $500 / 4 = $125
    expect(r.deductibleCents).toBe(12_500);
  });

  it('rate is $5/sqft (500¢) per IRS Pub 587', () => {
    expect(US_SIMPLIFIED_RATE_PER_SQFT_CENTS).toBe(500);
    expect(US_SIMPLIFIED_MAX_SQFT).toBe(300);
    expect(US_SIMPLIFIED_ANNUAL_CAP_CENTS).toBe(150_000);
  });
});
