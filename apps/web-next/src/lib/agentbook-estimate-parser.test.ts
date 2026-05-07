/**
 * Unit tests for the estimate NL parser. Mirrors the invoice parser test
 * (PR 1) — exercise the regex fallback directly so the suite runs offline;
 * the Gemini path is integration-tested elsewhere.
 */

import { describe, expect, it, vi } from 'vitest';
// Stub `server-only` so the parser can be loaded in a vitest environment.
vi.mock('server-only', () => ({}));
import {
  parseCreateEstimateWithRegex,
  parseConvertEstimateWithRegex,
} from './agentbook-estimate-parser';

describe('parseCreateEstimateWithRegex', () => {
  it('parses a simple "estimate Beta $4K for new website"', () => {
    const r = parseCreateEstimateWithRegex('estimate Beta $4K for new website');
    expect(r).not.toBeNull();
    expect(r?.clientNameHint).toBe('Beta');
    expect(r?.amountCents).toBe(400000);
    expect(r?.description).toBe('new website');
    expect(r?.confidence).toBeGreaterThanOrEqual(0.7);
  });

  it('parses without "for"', () => {
    const r = parseCreateEstimateWithRegex('estimate Acme $2,500 retainer');
    expect(r).not.toBeNull();
    expect(r?.clientNameHint).toBe('Acme');
    expect(r?.amountCents).toBe(250000);
    expect(r?.description).toBe('retainer');
  });

  it('handles the "quote" verb', () => {
    const r = parseCreateEstimateWithRegex('quote TechCorp $10K for redesign');
    expect(r).not.toBeNull();
    expect(r?.clientNameHint).toBe('TechCorp');
    expect(r?.amountCents).toBe(1000000);
    expect(r?.description).toBe('redesign');
  });

  it('handles multi-word clients + decimal amounts', () => {
    const r = parseCreateEstimateWithRegex('estimate Acme Corp $1,234.56 for design work');
    expect(r).not.toBeNull();
    expect(r?.clientNameHint).toBe('Acme Corp');
    expect(r?.amountCents).toBe(123456);
    expect(r?.description).toBe('design work');
  });

  it('extracts validUntil hint when present', () => {
    const r = parseCreateEstimateWithRegex('estimate Beta $4K for website valid until 2026-06-30');
    expect(r).not.toBeNull();
    expect(r?.clientNameHint).toBe('Beta');
    expect(r?.validUntilHint).toBe('2026-06-30');
  });

  it('extracts a "valid 60 days" hint', () => {
    const r = parseCreateEstimateWithRegex('estimate Beta $4K for site, valid 60 days');
    expect(r).not.toBeNull();
    expect(r?.validUntilHint).toBe('60 days');
  });

  it('returns null when not an estimate trigger', () => {
    expect(parseCreateEstimateWithRegex('hi there')).toBeNull();
    expect(parseCreateEstimateWithRegex('invoice Acme $5K for July')).toBeNull();
    expect(parseCreateEstimateWithRegex('spent $50 on lunch')).toBeNull();
  });

  it('returns null when amount is missing', () => {
    expect(parseCreateEstimateWithRegex('estimate Acme for some work')).toBeNull();
  });

  it('returns null when client is missing', () => {
    expect(parseCreateEstimateWithRegex('estimate $5000 for consulting')).toBeNull();
  });

  it('rejects negative or zero amounts', () => {
    expect(parseCreateEstimateWithRegex('estimate Acme $-500 for work')).toBeNull();
    expect(parseCreateEstimateWithRegex('estimate Acme $0 for work')).toBeNull();
  });
});

describe('parseConvertEstimateWithRegex', () => {
  it('parses "convert estimate EST-2026-003 to invoice"', () => {
    const r = parseConvertEstimateWithRegex('convert estimate EST-2026-003 to invoice');
    expect(r).not.toBeNull();
    expect(r?.estimateNumberHint).toMatch(/EST-2026-003/i);
  });

  it('parses "make EST-2026-ABCD an invoice"', () => {
    const r = parseConvertEstimateWithRegex('make EST-2026-ABCD an invoice');
    expect(r).not.toBeNull();
    expect(r?.estimateNumberHint).toMatch(/EST-2026-ABCD/i);
  });

  it('parses "convert the most recent estimate to invoice"', () => {
    const r = parseConvertEstimateWithRegex('convert the most recent estimate to invoice');
    expect(r).not.toBeNull();
    expect(r?.useMostRecent).toBe(true);
  });

  it('parses "turn EST-2026-001 into an invoice"', () => {
    const r = parseConvertEstimateWithRegex('turn EST-2026-001 into an invoice');
    expect(r).not.toBeNull();
    expect(r?.estimateNumberHint).toMatch(/EST-2026-001/i);
  });

  it('returns null on unrelated input', () => {
    expect(parseConvertEstimateWithRegex('hi there')).toBeNull();
    expect(parseConvertEstimateWithRegex('invoice Acme $5K')).toBeNull();
  });

  it('returns null when neither id nor "most recent" appears', () => {
    expect(parseConvertEstimateWithRegex('convert estimate to invoice')).toBeNull();
  });
});
