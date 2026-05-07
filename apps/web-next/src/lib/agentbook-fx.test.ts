/**
 * Unit tests for the multi-currency FX library (PR 13).
 *
 * Covers:
 *   1. Identity (USD→USD) → rate=1, no fetch.
 *   2. Live fetch (frankfurter.app) on cache miss → upserted.
 *   3. Cache hit (today's row exists) → no fetch.
 *   4. Fetch failure → fallback to most-recent cached row (any prior date).
 *   5. Fetch failure with no cache → returns null (never throws).
 *   6. convertCents — applies rate + rounds to nearest cent.
 *   7. convertCents — same currency short-circuit (no DB hit).
 *   8. Bad inputs (empty / non-3-letter) → null without throwing.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));

vi.mock('@naap/database', () => {
  return {
    prisma: {
      abFxRate: {
        findUnique: vi.fn(),
        findFirst: vi.fn(),
        upsert: vi.fn(),
      },
    },
  };
});

import { prisma as db } from '@naap/database';
import { getRate, convertCents } from './agentbook-fx';

const mockedDb = db as unknown as {
  abFxRate: {
    findUnique: ReturnType<typeof vi.fn>;
    findFirst: ReturnType<typeof vi.fn>;
    upsert: ReturnType<typeof vi.fn>;
  };
};

const fetchMock = vi.fn();
global.fetch = fetchMock as unknown as typeof fetch;

beforeEach(() => {
  vi.clearAllMocks();
  fetchMock.mockReset();
  mockedDb.abFxRate.findUnique.mockReset();
  mockedDb.abFxRate.findFirst.mockReset();
  mockedDb.abFxRate.upsert.mockReset();
});

describe('getRate', () => {
  it('returns 1.0 for USD→USD without fetching or hitting cache', async () => {
    const rate = await getRate('USD', 'USD');
    expect(rate).not.toBeNull();
    expect(rate?.rate).toBe(1);
    expect(rate?.from).toBe('USD');
    expect(rate?.to).toBe('USD');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mockedDb.abFxRate.findUnique).not.toHaveBeenCalled();
  });

  it('fetches from frankfurter on cache miss and upserts', async () => {
    mockedDb.abFxRate.findUnique.mockResolvedValue(null);
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ amount: 1, base: 'EUR', date: '2026-05-06', rates: { USD: 1.08 } }),
    });
    mockedDb.abFxRate.upsert.mockResolvedValue({});

    const rate = await getRate('EUR', 'USD');
    expect(rate).not.toBeNull();
    expect(rate?.rate).toBeCloseTo(1.08, 4);
    expect(rate?.source).toBe('ecb');
    expect(rate?.from).toBe('EUR');
    expect(rate?.to).toBe('USD');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toContain('frankfurter.app');
    expect(fetchMock.mock.calls[0][0]).toContain('from=EUR');
    expect(fetchMock.mock.calls[0][0]).toContain('to=USD');
    expect(mockedDb.abFxRate.upsert).toHaveBeenCalledTimes(1);
  });

  it('returns cached rate without fetching when today\'s row exists', async () => {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    mockedDb.abFxRate.findUnique.mockResolvedValue({
      id: 'r1',
      fromCcy: 'EUR',
      toCcy: 'USD',
      rate: 1.075,
      date: today,
      source: 'ecb',
    });

    const rate = await getRate('EUR', 'USD');
    expect(rate).not.toBeNull();
    expect(rate?.rate).toBeCloseTo(1.075, 4);
    expect(rate?.source).toBe('cached');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mockedDb.abFxRate.upsert).not.toHaveBeenCalled();
  });

  it('falls back to most-recent prior cached row when fetch fails', async () => {
    mockedDb.abFxRate.findUnique.mockResolvedValue(null);
    fetchMock.mockRejectedValue(new Error('network down'));
    mockedDb.abFxRate.findFirst.mockResolvedValue({
      id: 'r-old',
      fromCcy: 'GBP',
      toCcy: 'USD',
      rate: 1.27,
      date: new Date('2026-04-01'),
      source: 'ecb',
    });

    const rate = await getRate('GBP', 'USD');
    expect(rate).not.toBeNull();
    expect(rate?.rate).toBeCloseTo(1.27, 4);
    expect(rate?.source).toBe('cached');
  });

  it('returns null when fetch fails and there is no cache (never throws)', async () => {
    mockedDb.abFxRate.findUnique.mockResolvedValue(null);
    fetchMock.mockResolvedValue({ ok: false, status: 503, json: async () => ({}) });
    mockedDb.abFxRate.findFirst.mockResolvedValue(null);

    const rate = await getRate('EUR', 'USD');
    expect(rate).toBeNull();
  });

  it('returns null on bad input (empty / non-3-letter codes)', async () => {
    expect(await getRate('', 'USD')).toBeNull();
    expect(await getRate('EUR', '')).toBeNull();
    expect(await getRate('eu', 'USD')).toBeNull();
    expect(await getRate('EUR', 'usdd')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('convertCents', () => {
  it('short-circuits same-currency conversions without DB / fetch', async () => {
    const out = await convertCents(50000, 'USD', 'USD');
    expect(out).not.toBeNull();
    expect(out?.amountCents).toBe(50000);
    expect(out?.rate.rate).toBe(1);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mockedDb.abFxRate.findUnique).not.toHaveBeenCalled();
  });

  it('multiplies cents by rate and rounds to nearest cent (€500 @1.08 → $540.00)', async () => {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    mockedDb.abFxRate.findUnique.mockResolvedValue({
      id: 'r1',
      fromCcy: 'EUR',
      toCcy: 'USD',
      rate: 1.08,
      date: today,
      source: 'ecb',
    });

    const out = await convertCents(50_000 /* €500.00 */, 'EUR', 'USD');
    expect(out).not.toBeNull();
    expect(out?.amountCents).toBe(54_000); // $540.00
    expect(out?.rate.rate).toBeCloseTo(1.08);
  });

  it('returns null when rate is unavailable', async () => {
    mockedDb.abFxRate.findUnique.mockResolvedValue(null);
    fetchMock.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
    mockedDb.abFxRate.findFirst.mockResolvedValue(null);

    const out = await convertCents(50_000, 'EUR', 'USD');
    expect(out).toBeNull();
  });
});
