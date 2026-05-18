import { describe, expect, it, vi, beforeEach } from 'vitest';

const findUnique = vi.fn();
const planFindFirst = vi.fn().mockResolvedValue(null);
const planCount = vi.fn().mockResolvedValue(1); // by default: billing IS configured
vi.mock('@naap/database', () => ({
  prisma: {
    billSubscription: { findUnique: (...a: unknown[]) => findUnique(...a) },
    billPlan: {
      findFirst: (...a: unknown[]) => planFindFirst(...a),
      count: (...a: unknown[]) => planCount(...a),
    },
    billUsageCounter: { findMany: vi.fn().mockResolvedValue([]) },
  },
}));

import { canUseFeature } from '../src/features.js';
import { _resetCacheForTests } from '../src/plans.js';

beforeEach(() => {
  findUnique.mockReset();
  planFindFirst.mockReset();
  planFindFirst.mockResolvedValue(null);
  planCount.mockReset();
  planCount.mockResolvedValue(1);
  _resetCacheForTests();
});

describe('canUseFeature', () => {
  it('returns true when feature flag is true', async () => {
    findUnique.mockResolvedValue({
      planId: 'p', status: 'active', currentPeriodStart: null, currentPeriodEnd: null, cancelAtPeriodEnd: false,
      plan: {
        id: 'p', code: 'pro',
        features: { telegram_bot: true, tax_package_generation: true, multi_user_teams: false },
        quotas: { expenses_created: 0, ocr_scans: 0, ai_messages: 0, invoices_sent: 0, bank_connections: 0 },
      },
    });
    expect(await canUseFeature('t1', 'telegram_bot')).toBe(true);
    expect(await canUseFeature('t1', 'multi_user_teams')).toBe(false);
  });

  it('past_due is treated as still allowed (Stripe handles 7-day dunning)', async () => {
    findUnique.mockResolvedValue({
      planId: 'p', status: 'past_due', currentPeriodStart: null, currentPeriodEnd: null, cancelAtPeriodEnd: false,
      plan: {
        id: 'p', code: 'pro',
        features: { telegram_bot: true, tax_package_generation: false, multi_user_teams: false },
        quotas: { expenses_created: 0, ocr_scans: 0, ai_messages: 0, invoices_sent: 0, bank_connections: 0 },
      },
    });
    expect(await canUseFeature('t1', 'telegram_bot')).toBe(true);
  });

  it('canceled status degrades to no premium features', async () => {
    findUnique.mockResolvedValue({
      planId: 'p', status: 'canceled', currentPeriodStart: null, currentPeriodEnd: null, cancelAtPeriodEnd: false,
      plan: {
        id: 'p', code: 'pro',
        features: { telegram_bot: true, tax_package_generation: true, multi_user_teams: false },
        quotas: { expenses_created: 0, ocr_scans: 0, ai_messages: 0, invoices_sent: 0, bank_connections: 0 },
      },
    });
    expect(await canUseFeature('t1', 'telegram_bot')).toBe(false);
  });

  it('fails open on DB error', async () => {
    findUnique.mockRejectedValue(new Error('db down'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await canUseFeature('t1', 'telegram_bot')).toBe(true);
    warn.mockRestore();
  });

  it('grants access when no plans configured anywhere (billing inactive)', async () => {
    findUnique.mockResolvedValue(null);
    planFindFirst.mockResolvedValue(null);
    planCount.mockResolvedValue(0); // zero plans → billing not opted in
    expect(await canUseFeature('t1', 'telegram_bot')).toBe(true);
    expect(await canUseFeature('t1', 'tax_package_generation')).toBe(true);
  });
});
