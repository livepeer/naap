/**
 * Unit tests for the saved-search engine (PR 17).
 *
 * `runSavedSearch` builds a Prisma `where` clause from a SearchQuery and
 * fans the read out across the relevant entity tables (`AbExpense`,
 * `AbInvoice`, `AbMileageEntry`) based on the requested `scope`. The
 * engine is tenant-scoped, capped at 200 rows, and treats every filter
 * as optional.
 *
 * Cases:
 *   1. Scope=expense, no filters → returns up to 200 expenses for tenant
 *   2. Scope=expense, vendorName filter → forwards to vendor join
 *   3. Scope=expense, amount range + date range → builds AND clause
 *   4. Scope=expense, isPersonal flag → forwards as-is
 *   5. Scope=invoice → reads from abInvoice with date range
 *   6. Scope=mileage → reads from abMileageEntry
 *   7. Scope=all → fans out across all three entity types
 *   8. Cap to 200 rows enforced via take=200
 *   9. Tenant scoping — tenantId always present in where clause
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));

vi.mock('@naap/database', () => {
  return {
    prisma: {
      abExpense: { findMany: vi.fn() },
      abInvoice: { findMany: vi.fn() },
      abMileageEntry: { findMany: vi.fn() },
    },
  };
});

import { prisma as db } from '@naap/database';
import { runSavedSearch, buildExpenseWhere } from './agentbook-search';

const mocked = db as unknown as {
  abExpense: { findMany: ReturnType<typeof vi.fn> };
  abInvoice: { findMany: ReturnType<typeof vi.fn> };
  abMileageEntry: { findMany: ReturnType<typeof vi.fn> };
};

const TENANT = 'tenant-srch';

beforeEach(() => {
  mocked.abExpense.findMany.mockResolvedValue([]);
  mocked.abInvoice.findMany.mockResolvedValue([]);
  mocked.abMileageEntry.findMany.mockResolvedValue([]);
});

describe('buildExpenseWhere', () => {
  it('1. scopes by tenantId always', () => {
    const where = buildExpenseWhere(TENANT, { scope: 'expense' });
    expect(where.tenantId).toBe(TENANT);
  });

  it('2. translates amount range to amountCents.gte/lte', () => {
    const where = buildExpenseWhere(TENANT, {
      scope: 'expense',
      amountMinCents: 5000,
      amountMaxCents: 50000,
    });
    expect(where.amountCents).toEqual({ gte: 5000, lte: 50000 });
  });

  it('3. translates date range to date.gte/lte', () => {
    const where = buildExpenseWhere(TENANT, {
      scope: 'expense',
      startDate: '2026-01-01',
      endDate: '2026-12-31',
    });
    expect(where.date.gte).toBeInstanceOf(Date);
    expect(where.date.lte).toBeInstanceOf(Date);
  });

  it('4. forwards isPersonal flag', () => {
    const where = buildExpenseWhere(TENANT, { scope: 'expense', isPersonal: false });
    expect(where.isPersonal).toBe(false);
  });

  it('5. forwards isDeductible flag', () => {
    const where = buildExpenseWhere(TENANT, { scope: 'expense', isDeductible: true });
    expect(where.isDeductible).toBe(true);
  });

  it('6. vendorName builds an insensitive contains filter on vendor.name', () => {
    const where = buildExpenseWhere(TENANT, { scope: 'expense', vendorName: 'Starbucks' });
    expect(where.vendor).toEqual({
      name: { contains: 'Starbucks', mode: 'insensitive' },
    });
  });

  it('7. categoryName forwards as a description-OR-vendor contains filter', () => {
    const where = buildExpenseWhere(TENANT, { scope: 'expense', categoryName: 'Meals' });
    // Encoded as a top-level OR on description / tags / vendor name.
    expect(Array.isArray(where.OR)).toBe(true);
  });
});

describe('runSavedSearch', () => {
  it('1. scope=expense calls abExpense.findMany with tenant scope and 200 cap', async () => {
    mocked.abExpense.findMany.mockResolvedValue([{ id: 'e1' }]);
    const out = await runSavedSearch(TENANT, { scope: 'expense' });
    expect(mocked.abExpense.findMany).toHaveBeenCalledTimes(1);
    const call = mocked.abExpense.findMany.mock.calls[0][0];
    expect(call.where.tenantId).toBe(TENANT);
    expect(call.take).toBe(200);
    expect(out.scope).toBe('expense');
    expect(out.count).toBe(1);
  });

  it('2. scope=invoice reads only from abInvoice', async () => {
    mocked.abInvoice.findMany.mockResolvedValue([{ id: 'i1' }, { id: 'i2' }]);
    const out = await runSavedSearch(TENANT, {
      scope: 'invoice',
      startDate: '2026-01-01',
      endDate: '2026-06-30',
    });
    expect(mocked.abInvoice.findMany).toHaveBeenCalledTimes(1);
    expect(mocked.abExpense.findMany).not.toHaveBeenCalled();
    expect(mocked.abMileageEntry.findMany).not.toHaveBeenCalled();
    expect(out.scope).toBe('invoice');
    expect(out.count).toBe(2);
  });

  it('3. scope=mileage reads only from abMileageEntry', async () => {
    mocked.abMileageEntry.findMany.mockResolvedValue([{ id: 'm1' }]);
    const out = await runSavedSearch(TENANT, { scope: 'mileage' });
    expect(mocked.abMileageEntry.findMany).toHaveBeenCalledTimes(1);
    expect(mocked.abExpense.findMany).not.toHaveBeenCalled();
    expect(mocked.abInvoice.findMany).not.toHaveBeenCalled();
    expect(out.scope).toBe('mileage');
    expect(out.count).toBe(1);
  });

  it('4. scope=all fans out across all three tables', async () => {
    mocked.abExpense.findMany.mockResolvedValue([{ id: 'e1' }]);
    mocked.abInvoice.findMany.mockResolvedValue([{ id: 'i1' }]);
    mocked.abMileageEntry.findMany.mockResolvedValue([{ id: 'm1' }]);
    const out = await runSavedSearch(TENANT, { scope: 'all' });
    expect(mocked.abExpense.findMany).toHaveBeenCalledTimes(1);
    expect(mocked.abInvoice.findMany).toHaveBeenCalledTimes(1);
    expect(mocked.abMileageEntry.findMany).toHaveBeenCalledTimes(1);
    expect(out.scope).toBe('all');
    expect(out.count).toBe(3);
  });

  it('5. caps at 200 rows even when total across scopes would exceed', async () => {
    const big = Array.from({ length: 250 }, (_, i) => ({ id: `e${i}` }));
    mocked.abExpense.findMany.mockResolvedValue(big);
    const out = await runSavedSearch(TENANT, { scope: 'expense' });
    // The query itself caps at 200; even if mock returns more, output is capped.
    expect(out.rows.length).toBeLessThanOrEqual(200);
  });

  it('6. tenant scoping — never queries without tenantId', async () => {
    await runSavedSearch(TENANT, { scope: 'all' });
    for (const t of [mocked.abExpense, mocked.abInvoice, mocked.abMileageEntry]) {
      const call = t.findMany.mock.calls[0][0];
      expect(call.where.tenantId).toBe(TENANT);
    }
  });

  it('7. amount filter is forwarded to abExpense', async () => {
    await runSavedSearch(TENANT, {
      scope: 'expense',
      amountMinCents: 5000,
    });
    const call = mocked.abExpense.findMany.mock.calls[0][0];
    expect(call.where.amountCents).toEqual({ gte: 5000 });
  });

  it('8. ordering — expenses ordered by date desc', async () => {
    await runSavedSearch(TENANT, { scope: 'expense' });
    const call = mocked.abExpense.findMany.mock.calls[0][0];
    expect(call.orderBy).toEqual({ date: 'desc' });
  });
});
