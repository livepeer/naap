import { describe, expect, it, vi, beforeEach } from 'vitest';

const findUnique = vi.fn();
const findFirst = vi.fn();
const findMany = vi.fn();
const count = vi.fn();

vi.mock('@naap/database', () => ({
  prisma: {
    billSubscription: { findUnique: (...a: unknown[]) => findUnique(...a) },
    billPlan: {
      findFirst: (...a: unknown[]) => findFirst(...a),
      count: (...a: unknown[]) => count(...a),
    },
    billUsageCounter: { findMany: (...a: unknown[]) => findMany(...a) },
  },
}));

import { getCurrentPlan, _resetCacheForTests } from '../src/plans.js';

const freePlan = {
  id: 'plan-free', code: 'free', name: 'Free', priceCents: 0, isActive: true,
  features: { telegram_bot: false, tax_package_generation: false, multi_user_teams: false },
  quotas: { expenses_created: 50, ocr_scans: 10, ai_messages: 100, invoices_sent: 5, bank_connections: 0 },
};

const proPlan = {
  id: 'plan-pro', code: 'pro', name: 'Pro', priceCents: 1900, isActive: true,
  features: { telegram_bot: true, tax_package_generation: true, multi_user_teams: false },
  quotas: { expenses_created: 1000, ocr_scans: 200, ai_messages: 5000, invoices_sent: 200, bank_connections: 3 },
};

beforeEach(() => {
  findUnique.mockReset();
  findFirst.mockReset();
  findMany.mockReset();
  count.mockReset();
  _resetCacheForTests();
});

describe('getCurrentPlan', () => {
  it('returns the Free plan when no subscription but a Free plan is configured', async () => {
    findUnique.mockResolvedValue(null);
    findFirst.mockResolvedValue(freePlan);
    findMany.mockResolvedValue([]);
    const r = await getCurrentPlan('account-1');
    expect(r.plan.code).toBe('free');
    expect(r.status).toBe('active');
    expect(r.usage.ocr_scans.used).toBe(0);
  });

  it('returns the billing-inactive marker when no plans exist at all', async () => {
    findUnique.mockResolvedValue(null);
    findFirst.mockResolvedValue(null); // no Free plan
    count.mockResolvedValue(0);         // zero active plans anywhere
    findMany.mockResolvedValue([]);
    const r = await getCurrentPlan('account-1');
    expect(r.plan.code).toBe('__billing_inactive__');
    expect(r.plan.features.telegram_bot).toBe(true);
    expect(r.plan.quotas.ocr_scans).toBe(-1);
  });

  it('returns synthetic Free (restrictive) when plans exist but no Free + no sub', async () => {
    findUnique.mockResolvedValue(null);
    findFirst.mockResolvedValue(null); // no Free plan
    count.mockResolvedValue(2);         // but Pro + Business are configured
    findMany.mockResolvedValue([]);
    const r = await getCurrentPlan('account-1');
    expect(r.plan.code).toBe('free');
    expect(r.plan.features.telegram_bot).toBe(false);
  });

  it('returns the Pro plan when subscription is active', async () => {
    findUnique.mockResolvedValue({
      planId: 'plan-pro', status: 'active',
      currentPeriodStart: new Date(),
      currentPeriodEnd: new Date(Date.now() + 30 * 86400_000),
      cancelAtPeriodEnd: false, plan: proPlan,
    });
    findMany.mockResolvedValue([{ dimension: 'ocr_scans', count: 47 }]);
    const r = await getCurrentPlan('account-1');
    expect(r.plan.code).toBe('pro');
    expect(r.usage.ocr_scans.used).toBe(47);
    expect(r.usage.ocr_scans.limit).toBe(200);
  });

  it('hits cache on second call', async () => {
    findUnique.mockResolvedValue({
      planId: 'plan-pro', status: 'active',
      currentPeriodStart: new Date(),
      currentPeriodEnd: new Date(Date.now() + 30 * 86400_000),
      cancelAtPeriodEnd: false, plan: proPlan,
    });
    findMany.mockResolvedValue([]);
    await getCurrentPlan('account-1');
    await getCurrentPlan('account-1');
    expect(findUnique).toHaveBeenCalledTimes(1);
  });

  it('fails open on DB error — returns synthetic Free plan, logs warning', async () => {
    findUnique.mockRejectedValue(new Error('db down'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const r = await getCurrentPlan('account-1');
    expect(r.plan.code).toBe('free');
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
