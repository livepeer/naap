/** @vitest-environment node */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({
  prisma: {
    subscription: { findUnique: vi.fn() },
  },
}));

const isFeatureEnabled = vi.fn();
vi.mock('@/lib/feature-flags', () => ({
  isFeatureEnabled: (...a: unknown[]) => isFeatureEnabled(...a),
  MULTI_SUBSCRIPTION_FLAG: 'multi_subscription',
}));

import { prisma } from '@/lib/db';
import { MULTI_SUBSCRIPTION_FLAG, resolveSubscriptionForKey } from './subscription';

const findUnique = prisma.subscription.findUnique as ReturnType<typeof vi.fn>;

const ACTIVE_ROW = {
  id: 'sub_1',
  teamId: 'team_1',
  providerInstanceId: 'pi_default',
  providerPlanId: null,
  accountId: 'acct_1',
  status: 'active',
  appId: null,
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('resolveSubscriptionForKey', () => {
  it('exposes the canonical flag key', () => {
    expect(MULTI_SUBSCRIPTION_FLAG).toBe('multi_subscription');
  });

  describe('INV-availability: legacy path is byte-for-byte unchanged', () => {
    it('flag OFF → legacy(flag_off) and NEVER reads the Subscription table (even if subscriptionId is set)', async () => {
      isFeatureEnabled.mockResolvedValue(false);
      const res = await resolveSubscriptionForKey({ subscriptionId: 'sub_1' });
      expect(res).toEqual({ mode: 'legacy', reason: 'flag_off' });
      expect(findUnique).not.toHaveBeenCalled();
    });

    it('flag ON + null subscriptionId → legacy(no_subscription), no DB read (today\'s key behavior)', async () => {
      isFeatureEnabled.mockResolvedValue(true);
      const res = await resolveSubscriptionForKey({ subscriptionId: null });
      expect(res).toEqual({ mode: 'legacy', reason: 'no_subscription' });
      expect(findUnique).not.toHaveBeenCalled();
    });
  });

  describe('flag ON → subscription linkage', () => {
    beforeEach(() => isFeatureEnabled.mockResolvedValue(true));

    it('active subscription → resolves to the subscription row', async () => {
      findUnique.mockResolvedValue(ACTIVE_ROW);
      const res = await resolveSubscriptionForKey({ subscriptionId: 'sub_1' });
      expect(res).toEqual({ mode: 'subscription', subscription: ACTIVE_ROW });
      expect(findUnique).toHaveBeenCalledWith({
        where: { id: 'sub_1' },
        select: {
          id: true,
          teamId: true,
          providerInstanceId: true,
          providerPlanId: true,
          accountId: true,
          status: true,
          appId: true,
        },
      });
    });

    it('missing row → fails closed to legacy(subscription_missing)', async () => {
      findUnique.mockResolvedValue(null);
      const res = await resolveSubscriptionForKey({ subscriptionId: 'sub_missing' });
      expect(res).toEqual({ mode: 'legacy', reason: 'subscription_missing' });
    });

    it('non-active subscription → fails closed to legacy(subscription_inactive)', async () => {
      findUnique.mockResolvedValue({ ...ACTIVE_ROW, status: 'canceled' });
      const res = await resolveSubscriptionForKey({ subscriptionId: 'sub_1' });
      expect(res).toEqual({ mode: 'legacy', reason: 'subscription_inactive' });
    });

    it('DB error → degrades to legacy(error), never throws', async () => {
      findUnique.mockRejectedValue(new Error('connection refused'));
      const res = await resolveSubscriptionForKey({ subscriptionId: 'sub_1' });
      expect(res).toEqual({ mode: 'legacy', reason: 'error' });
    });
  });
});
