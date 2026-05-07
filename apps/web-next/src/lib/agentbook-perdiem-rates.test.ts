/**
 * Tests for the per-diem rate lookup helper.
 *
 * Per-diem rates come from the GSA's published table of city-level
 * Meals & Incidental Expenses (M&IE) and Lodging rates. Travelers can
 * deduct these flat rates instead of itemising each meal, simplifying
 * Maya's "I was in NYC for 3 days" workflow into a single 3-row
 * expense booking.
 *
 * The helper is pure (no I/O), so the suite runs offline.
 */

import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));

import {
  lookupPerDiem,
  CONUS_DEFAULT_MIE_CENTS,
  CONUS_DEFAULT_LODGING_CENTS,
} from './agentbook-perdiem-rates';

describe('lookupPerDiem', () => {
  it('NYC → high-cost M&IE + lodging rates', () => {
    const r = lookupPerDiem('NYC');
    expect(r).not.toBeNull();
    expect(r!.city).toMatch(/new york|nyc/i);
    expect(r!.state).toBe('NY');
    expect(r!.mieCents).toBeGreaterThan(CONUS_DEFAULT_MIE_CENTS);
    expect(r!.lodgingCents).toBeGreaterThan(CONUS_DEFAULT_LODGING_CENTS);
  });

  it('case-insensitive city lookup ("new york" matches NYC)', () => {
    const a = lookupPerDiem('New York');
    const b = lookupPerDiem('new york');
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(a!.mieCents).toBe(b!.mieCents);
  });

  it('San Francisco is in the high-cost bundled table', () => {
    const r = lookupPerDiem('San Francisco');
    expect(r).not.toBeNull();
    expect(r!.state).toBe('CA');
    expect(r!.mieCents).toBeGreaterThan(CONUS_DEFAULT_MIE_CENTS);
  });

  it('Chicago / Boston / DC / Seattle / Austin / LA all bundled', () => {
    for (const city of ['Chicago', 'Boston', 'Washington DC', 'Seattle', 'Austin', 'Los Angeles']) {
      const r = lookupPerDiem(city);
      expect(r, `expected ${city} to be in the bundled table`).not.toBeNull();
      expect(r!.mieCents).toBeGreaterThan(0);
      expect(r!.lodgingCents).toBeGreaterThan(0);
    }
  });

  it('unknown city returns the CONUS standard fallback ($59 M&IE)', () => {
    const r = lookupPerDiem('Tinytown, KY');
    expect(r).not.toBeNull();
    expect(r!.mieCents).toBe(CONUS_DEFAULT_MIE_CENTS);
    // Default fallback exposes a sensible (mid-range) lodging too —
    // callers can opt to ignore lodging when the location is unknown.
    expect(r!.lodgingCents).toBe(CONUS_DEFAULT_LODGING_CENTS);
  });

  it('CONUS standard M&IE = $59 (5900 cents) per IRS / GSA', () => {
    expect(CONUS_DEFAULT_MIE_CENTS).toBe(5900);
  });

  it('blank / whitespace-only input returns the CONUS fallback', () => {
    const a = lookupPerDiem('');
    const b = lookupPerDiem('   ');
    expect(a!.mieCents).toBe(CONUS_DEFAULT_MIE_CENTS);
    expect(b!.mieCents).toBe(CONUS_DEFAULT_MIE_CENTS);
  });

  it('common abbreviations resolve (DC → Washington DC, LA → Los Angeles)', () => {
    const dc = lookupPerDiem('DC');
    const la = lookupPerDiem('LA');
    expect(dc!.state).toBe('DC');
    expect(la!.state).toBe('CA');
  });
});
