/**
 * Tests for the catch-me-up helper (PR 20).
 *
 * Maya types "catch me up" and the bot replies with a tight bulleted
 * summary of what changed since her last interaction: cash delta,
 * paid invoices, auto-categorised expenses, anything needing review,
 * bank-sync count, etc. The helper here is the pure DB-read core that
 * powers both the bot reply and the `?catchup=1` web banner.
 *
 * Pinned guarantees:
 *   1. Aggregates the right buckets from AbExpense / AbInvoice /
 *      AbBankTransaction / AbAccountantRequest within `[sinceAt, now)`.
 *   2. Cash-change derives from invoice payments minus expenses booked
 *      since `sinceAt` (a coarse but useful approximation — the same
 *      one the dashboard "movement" strip uses).
 *   3. Tenant scoping — every query is filtered by tenantId; cross-
 *      tenant rows must NOT bleed into the summary.
 *   4. Empty state — when nothing changed since `sinceAt`, the helper
 *      returns a zeroed summary (not throws, not null).
 *
 * Pure unit-style: the Prisma client is mocked at the module boundary.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));

vi.mock('@naap/database', () => {
  return {
    prisma: {
      abExpense: {
        count: vi.fn(),
        aggregate: vi.fn(),
        findMany: vi.fn(),
      },
      abInvoice: {
        count: vi.fn(),
        aggregate: vi.fn(),
        findMany: vi.fn(),
      },
      abPayment: {
        aggregate: vi.fn(),
      },
      abBankTransaction: {
        count: vi.fn(),
      },
      abRecurringRule: {
        count: vi.fn(),
      },
      abAccountantRequest: {
        count: vi.fn(),
      },
    },
  };
});

import { prisma as db } from '@naap/database';
import { buildCatchUp } from './agentbook-catch-up';

const mockedDb = db as unknown as {
  abExpense: {
    count: ReturnType<typeof vi.fn>;
    aggregate: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
  };
  abInvoice: {
    count: ReturnType<typeof vi.fn>;
    aggregate: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
  };
  abPayment: { aggregate: ReturnType<typeof vi.fn> };
  abBankTransaction: { count: ReturnType<typeof vi.fn> };
  abRecurringRule: { count: ReturnType<typeof vi.fn> };
  abAccountantRequest: { count: ReturnType<typeof vi.fn> };
};

const TENANT = 'tenant-A';
const SINCE = new Date('2026-05-01T00:00:00Z');

beforeEach(() => {
  for (const m of [
    mockedDb.abExpense.count,
    mockedDb.abExpense.aggregate,
    mockedDb.abExpense.findMany,
    mockedDb.abInvoice.count,
    mockedDb.abInvoice.aggregate,
    mockedDb.abInvoice.findMany,
    mockedDb.abPayment.aggregate,
    mockedDb.abBankTransaction.count,
    mockedDb.abRecurringRule.count,
    mockedDb.abAccountantRequest.count,
  ]) {
    m.mockReset();
  }
});

describe('buildCatchUp — happy path', () => {
  it('aggregates expenses, invoices, payments, bank txns, recurring & CPA into ≤8 buckets', async () => {
    // 4 expenses created since `sinceAt`. 3 are auto-categorised
    // (confirmed + non-null categoryId), 1 needs review (status=pending_review).
    mockedDb.abExpense.findMany.mockResolvedValue([
      { id: 'e1', status: 'confirmed', categoryId: 'cat-1', source: 'bank_sync' },
      { id: 'e2', status: 'confirmed', categoryId: 'cat-2', source: 'manual' },
      { id: 'e3', status: 'confirmed', categoryId: 'cat-1', source: 'telegram_photo' },
      { id: 'e4', status: 'pending_review', categoryId: null, source: 'csv_import' },
    ]);
    mockedDb.abExpense.aggregate.mockResolvedValue({ _sum: { amountCents: 25_000 } });

    // 2 paid invoices ($800 + $1200), 1 sent (not yet paid, $400).
    mockedDb.abInvoice.findMany.mockResolvedValue([
      { id: 'i1', status: 'paid', amountCents: 80_000 },
      { id: 'i2', status: 'paid', amountCents: 120_000 },
      { id: 'i3', status: 'sent', amountCents: 40_000 },
    ]);
    mockedDb.abPayment.aggregate.mockResolvedValue({ _sum: { amountCents: 200_000 } });

    mockedDb.abBankTransaction.count.mockResolvedValue(17);
    mockedDb.abRecurringRule.count.mockResolvedValue(1);
    mockedDb.abAccountantRequest.count.mockResolvedValue(2);

    const summary = await buildCatchUp({ tenantId: TENANT, sinceAt: SINCE });

    expect(summary).toEqual({
      cashChangeCents: 200_000 - 25_000, // payments minus expenses since
      invoicesPaid: { count: 2, totalCents: 200_000 },
      invoicesSent: { count: 1, totalCents: 40_000 },
      expensesAutoCategorized: 3, // e1, e2, e3 (confirmed + categorised)
      expensesNeedReview: 1, // e4
      bankTransactionsSynced: 17,
      newRecurring: 1,
      cpaRequestsOpen: 2,
    });
  });
});

describe('buildCatchUp — tenant scoping', () => {
  it('every query filters by tenantId — cross-tenant rows cannot leak', async () => {
    mockedDb.abExpense.findMany.mockResolvedValue([]);
    mockedDb.abExpense.aggregate.mockResolvedValue({ _sum: { amountCents: 0 } });
    mockedDb.abInvoice.findMany.mockResolvedValue([]);
    mockedDb.abPayment.aggregate.mockResolvedValue({ _sum: { amountCents: 0 } });
    mockedDb.abBankTransaction.count.mockResolvedValue(0);
    mockedDb.abRecurringRule.count.mockResolvedValue(0);
    mockedDb.abAccountantRequest.count.mockResolvedValue(0);

    await buildCatchUp({ tenantId: TENANT, sinceAt: SINCE });

    // Verify every Prisma call was tenant-scoped.
    const findManyExpenseArgs = mockedDb.abExpense.findMany.mock.calls[0][0];
    expect(findManyExpenseArgs.where.tenantId).toBe(TENANT);

    const findManyInvoiceArgs = mockedDb.abInvoice.findMany.mock.calls[0][0];
    expect(findManyInvoiceArgs.where.tenantId).toBe(TENANT);

    const aggrPayArgs = mockedDb.abPayment.aggregate.mock.calls[0][0];
    expect(aggrPayArgs.where.tenantId).toBe(TENANT);

    const aggrExpArgs = mockedDb.abExpense.aggregate.mock.calls[0][0];
    expect(aggrExpArgs.where.tenantId).toBe(TENANT);

    const bankArgs = mockedDb.abBankTransaction.count.mock.calls[0][0];
    expect(bankArgs.where.tenantId).toBe(TENANT);

    const recArgs = mockedDb.abRecurringRule.count.mock.calls[0][0];
    expect(recArgs.where.tenantId).toBe(TENANT);

    const cpaArgs = mockedDb.abAccountantRequest.count.mock.calls[0][0];
    expect(cpaArgs.where.tenantId).toBe(TENANT);
  });

  it('every where-clause uses `gte: sinceAt` for the time window', async () => {
    mockedDb.abExpense.findMany.mockResolvedValue([]);
    mockedDb.abExpense.aggregate.mockResolvedValue({ _sum: { amountCents: 0 } });
    mockedDb.abInvoice.findMany.mockResolvedValue([]);
    mockedDb.abPayment.aggregate.mockResolvedValue({ _sum: { amountCents: 0 } });
    mockedDb.abBankTransaction.count.mockResolvedValue(0);
    mockedDb.abRecurringRule.count.mockResolvedValue(0);
    mockedDb.abAccountantRequest.count.mockResolvedValue(0);

    await buildCatchUp({ tenantId: TENANT, sinceAt: SINCE });

    // Spot-check the window boundary on a couple of calls.
    const expCreatedAt = mockedDb.abExpense.findMany.mock.calls[0][0].where.createdAt;
    expect(expCreatedAt.gte).toEqual(SINCE);

    const payDate = mockedDb.abPayment.aggregate.mock.calls[0][0].where.date;
    expect(payDate.gte).toEqual(SINCE);
  });
});

describe('buildCatchUp — empty state', () => {
  it('returns a zeroed summary when nothing changed since `sinceAt`', async () => {
    mockedDb.abExpense.findMany.mockResolvedValue([]);
    mockedDb.abExpense.aggregate.mockResolvedValue({ _sum: { amountCents: null } });
    mockedDb.abInvoice.findMany.mockResolvedValue([]);
    mockedDb.abPayment.aggregate.mockResolvedValue({ _sum: { amountCents: null } });
    mockedDb.abBankTransaction.count.mockResolvedValue(0);
    mockedDb.abRecurringRule.count.mockResolvedValue(0);
    mockedDb.abAccountantRequest.count.mockResolvedValue(0);

    const summary = await buildCatchUp({ tenantId: TENANT, sinceAt: SINCE });

    expect(summary).toEqual({
      cashChangeCents: 0,
      invoicesPaid: { count: 0, totalCents: 0 },
      invoicesSent: { count: 0, totalCents: 0 },
      expensesAutoCategorized: 0,
      expensesNeedReview: 0,
      bankTransactionsSynced: 0,
      newRecurring: 0,
      cpaRequestsOpen: 0,
    });
  });
});

describe('buildCatchUp — invoice bucketing', () => {
  it('counts paid vs sent independently and sums each bucket separately', async () => {
    mockedDb.abExpense.findMany.mockResolvedValue([]);
    mockedDb.abExpense.aggregate.mockResolvedValue({ _sum: { amountCents: 0 } });
    mockedDb.abInvoice.findMany.mockResolvedValue([
      { id: 'a', status: 'paid', amountCents: 50_000 },
      { id: 'b', status: 'paid', amountCents: 30_000 },
      { id: 'c', status: 'sent', amountCents: 25_000 },
      { id: 'd', status: 'sent', amountCents: 75_000 },
      { id: 'e', status: 'sent', amountCents: 10_000 },
      { id: 'f', status: 'draft', amountCents: 999 }, // ignored
      { id: 'g', status: 'overdue', amountCents: 999 }, // ignored
    ]);
    mockedDb.abPayment.aggregate.mockResolvedValue({ _sum: { amountCents: 80_000 } });
    mockedDb.abBankTransaction.count.mockResolvedValue(0);
    mockedDb.abRecurringRule.count.mockResolvedValue(0);
    mockedDb.abAccountantRequest.count.mockResolvedValue(0);

    const summary = await buildCatchUp({ tenantId: TENANT, sinceAt: SINCE });

    expect(summary.invoicesPaid).toEqual({ count: 2, totalCents: 80_000 });
    expect(summary.invoicesSent).toEqual({ count: 3, totalCents: 110_000 });
  });
});

describe('buildCatchUp — review classification', () => {
  it('classifies pending_review expenses as needs-review, ignores rejected, only counts confirmed+categorised as auto-categorised', async () => {
    mockedDb.abExpense.findMany.mockResolvedValue([
      { id: '1', status: 'confirmed', categoryId: 'c1', source: 'manual' },
      { id: '2', status: 'pending_review', categoryId: null, source: 'bank_sync' },
      { id: '3', status: 'pending_review', categoryId: 'c2', source: 'bank_sync' }, // still needs review
      { id: '4', status: 'rejected', categoryId: 'c3', source: 'csv_import' }, // ignored
      { id: '5', status: 'confirmed', categoryId: null, source: 'manual' }, // confirmed but uncategorised — neither bucket
    ]);
    mockedDb.abExpense.aggregate.mockResolvedValue({ _sum: { amountCents: 0 } });
    mockedDb.abInvoice.findMany.mockResolvedValue([]);
    mockedDb.abPayment.aggregate.mockResolvedValue({ _sum: { amountCents: 0 } });
    mockedDb.abBankTransaction.count.mockResolvedValue(0);
    mockedDb.abRecurringRule.count.mockResolvedValue(0);
    mockedDb.abAccountantRequest.count.mockResolvedValue(0);

    const summary = await buildCatchUp({ tenantId: TENANT, sinceAt: SINCE });

    expect(summary.expensesAutoCategorized).toBe(1); // only id=1
    expect(summary.expensesNeedReview).toBe(2); // ids 2, 3
  });
});
