/**
 * Unit tests for the multi-currency leg of `createInvoiceDraft` (PR 13).
 *
 * The classic "$5K consulting" path is covered by the e2e suite. Here we
 * focus on the conversion math:
 *
 *   • USD-quoted invoice for a USD tenant → no original* fields set.
 *   • EUR-quoted invoice for a USD tenant @ rate 1.08 → booked in USD,
 *     original* fields populated.
 *   • EUR-quoted invoice for a USD tenant where the rate is unavailable
 *     → booked in EUR (graceful degradation), original* fields NOT set.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));

vi.mock('@naap/database', () => {
  return {
    prisma: {
      abTenantConfig: { findUnique: vi.fn() },
      abInvoice: { findFirst: vi.fn(), create: vi.fn() },
      abEvent: { create: vi.fn() },
      abFxRate: {
        findUnique: vi.fn(),
        findFirst: vi.fn(),
        upsert: vi.fn(),
      },
      $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          abInvoice: {
            findFirst: vi.fn().mockResolvedValue(null),
            create: vi.fn(async (args: { data: Record<string, unknown> }) => ({
              id: 'inv-1',
              number: 'INV-2026-0001',
              ...args.data,
              lines: (args.data.lines as { create: unknown[] } | undefined)?.create ?? [],
            })),
          },
        }),
      ),
    },
  };
});

import { prisma as db } from '@naap/database';
import { createInvoiceDraft } from './agentbook-invoice-draft';

const mockedDb = db as unknown as {
  abTenantConfig: { findUnique: ReturnType<typeof vi.fn> };
  abEvent: { create: ReturnType<typeof vi.fn> };
  abFxRate: {
    findUnique: ReturnType<typeof vi.fn>;
    findFirst: ReturnType<typeof vi.fn>;
    upsert: ReturnType<typeof vi.fn>;
  };
  $transaction: ReturnType<typeof vi.fn>;
};

const fetchMock = vi.fn();
global.fetch = fetchMock as unknown as typeof fetch;

beforeEach(() => {
  vi.clearAllMocks();
  fetchMock.mockReset();
  mockedDb.abTenantConfig.findUnique.mockResolvedValue({ currency: 'USD' });
  mockedDb.abEvent.create.mockResolvedValue({});
  mockedDb.abFxRate.findUnique.mockResolvedValue(null);
  mockedDb.abFxRate.findFirst.mockResolvedValue(null);
  mockedDb.abFxRate.upsert.mockResolvedValue({});
});

const baseInput = {
  tenantId: 'tenant-1',
  client: { id: 'c1', name: 'Beta', email: 'b@x.com' },
};

describe('createInvoiceDraft — multi-currency', () => {
  it('USD invoice for a USD tenant: no original* fields', async () => {
    const result = await createInvoiceDraft({
      ...baseInput,
      parsed: {
        currencyHint: 'USD',
        lines: [{ description: 'consulting', rateCents: 500_000, quantity: 1 }],
      },
    });

    expect(result.currency).toBe('USD');
    expect(result.totalCents).toBe(500_000);
    expect(result.originalCurrency).toBeUndefined();
    expect(result.fxRate).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('EUR invoice for a USD tenant: converts at fetched rate, populates original*', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ amount: 1, base: 'EUR', date: '2026-05-06', rates: { USD: 1.08 } }),
    });

    const result = await createInvoiceDraft({
      ...baseInput,
      parsed: {
        currencyHint: 'EUR',
        lines: [{ description: 'design', rateCents: 50_000, quantity: 1 }], // €500.00
      },
    });

    // Booked in tenant currency (USD)
    expect(result.currency).toBe('USD');
    expect(result.totalCents).toBe(54_000); // $540.00
    // Original currency tracking
    expect(result.originalCurrency).toBe('EUR');
    expect(result.originalAmountCents).toBe(50_000);
    expect(result.fxRate).toBeCloseTo(1.08, 4);
    expect(result.fxRateSource).toBe('ecb');
  });

  it('falls back to booking in quoted currency when no rate available', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 503, json: async () => ({}) });
    mockedDb.abFxRate.findFirst.mockResolvedValue(null);

    const result = await createInvoiceDraft({
      ...baseInput,
      parsed: {
        currencyHint: 'EUR',
        lines: [{ description: 'design', rateCents: 50_000, quantity: 1 }],
      },
    });

    // No conversion possible — book in tenant currency *amount* anyway,
    // do NOT lie about an FX rate. original* must remain unset.
    expect(result.currency).toBe('USD');
    expect(result.totalCents).toBe(50_000);
    expect(result.originalCurrency).toBeUndefined();
    expect(result.fxRate).toBeUndefined();
  });
});
