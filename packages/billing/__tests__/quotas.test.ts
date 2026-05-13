import { describe, expect, it, vi, beforeEach } from 'vitest';

const findUnique = vi.fn();
const findMany = vi.fn();
const upsert = vi.fn();

vi.mock('@naap/database', () => ({
  prisma: {
    billSubscription: { findUnique: (...a: unknown[]) => findUnique(...a) },
    billPlan: { findFirst: vi.fn().mockResolvedValue(null) },
    billUsageCounter: {
      findMany: (...a: unknown[]) => findMany(...a),
      upsert: (...a: unknown[]) => upsert(...a),
    },
  },
}));

import { checkQuota, incrementUsage, getUsage } from '../src/quotas.js';
import { _resetCacheForTests } from '../src/plans.js';

const proSub = {
  planId: 'p', status: 'active',
  currentPeriodStart: new Date('2026-05-01'),
  currentPeriodEnd: new Date('2026-06-01'),
  cancelAtPeriodEnd: false,
  plan: {
    id: 'p', code: 'pro',
    features: { telegram_bot: true, tax_package_generation: true, multi_user_teams: false },
    quotas: { expenses_created: 1000, ocr_scans: 10, ai_messages: 5000, invoices_sent: 200, bank_connections: 3 },
  },
};

beforeEach(() => {
  findUnique.mockReset(); findMany.mockReset(); upsert.mockReset();
  _resetCacheForTests();
});

describe('checkQuota', () => {
  it('allowed when used < limit', async () => {
    findUnique.mockResolvedValue(proSub);
    findMany.mockResolvedValue([{ dimension: 'ocr_scans', count: 3 }]);
    const q = await checkQuota('t1', 'ocr_scans');
    expect(q).toEqual({ allowed: true, used: 3, limit: 10, remaining: 7 });
  });

  it('blocked when used >= limit', async () => {
    findUnique.mockResolvedValue(proSub);
    findMany.mockResolvedValue([{ dimension: 'ocr_scans', count: 10 }]);
    const q = await checkQuota('t1', 'ocr_scans');
    expect(q.allowed).toBe(false);
    expect(q.remaining).toBe(0);
  });

  it('unlimited when limit === -1', async () => {
    findUnique.mockResolvedValue({ ...proSub, plan: { ...proSub.plan, quotas: { ...proSub.plan.quotas, ocr_scans: -1 } } });
    findMany.mockResolvedValue([{ dimension: 'ocr_scans', count: 9999 }]);
    const q = await checkQuota('t1', 'ocr_scans');
    expect(q.allowed).toBe(true);
    expect(q.limit).toBe(-1);
    expect(q.remaining).toBe(Number.POSITIVE_INFINITY);
  });

  it('fails open on DB error', async () => {
    findUnique.mockRejectedValue(new Error('db down'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const q = await checkQuota('t1', 'ocr_scans');
    expect(q.allowed).toBe(true);
    warn.mockRestore();
  });
});

describe('incrementUsage', () => {
  it('upserts and increments by n', async () => {
    findUnique.mockResolvedValue(proSub);
    findMany.mockResolvedValue([]);
    upsert.mockResolvedValue({});
    await incrementUsage('t1', 'ocr_scans', 3);
    expect(upsert).toHaveBeenCalledTimes(1);
    const call = upsert.mock.calls[0][0] as { update: { count: { increment: number } }; create: { count: number } };
    expect(call.update.count.increment).toBe(3);
    expect(call.create.count).toBe(3);
  });

  it('swallows errors silently', async () => {
    findUnique.mockResolvedValue(proSub);
    findMany.mockResolvedValue([]);
    upsert.mockRejectedValue(new Error('db down'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(incrementUsage('t1', 'ocr_scans')).resolves.toBeUndefined();
    warn.mockRestore();
  });

  it('upserts even when subscription has no currentPeriodStart (Free fallback)', async () => {
    findUnique.mockResolvedValue({ ...proSub, currentPeriodStart: null, currentPeriodEnd: null });
    findMany.mockResolvedValue([]);
    upsert.mockResolvedValue({});
    await incrementUsage('t1', 'ocr_scans');
    expect(upsert).toHaveBeenCalledTimes(1);
  });
});

describe('getUsage', () => {
  it('returns used count for a dimension', async () => {
    findUnique.mockResolvedValue(proSub);
    findMany.mockResolvedValue([{ dimension: 'ocr_scans', count: 5 }]);
    expect(await getUsage('t1', 'ocr_scans')).toBe(5);
  });
});
