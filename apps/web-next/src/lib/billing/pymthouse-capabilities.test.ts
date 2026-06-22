/** @vitest-environment node */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getUserSubscription = vi.fn();
const listBillingProducts = vi.fn();

vi.mock('@/lib/pymthouse-client', () => ({
  getPmtHouseServerClient: () => ({ getUserSubscription, listBillingProducts }),
}));

import {
  resolvePymthouseCapabilities,
  resetPymthouseCapabilityCacheForTests,
} from './pymthouse-capabilities';

const ACCOUNT = 'acct_om_1';

function subscription(planId: string | null) {
  return {
    externalUserId: ACCOUNT,
    subscription:
      planId === null
        ? null
        : {
            id: 'sub_local_1',
            status: 'active',
            planId,
            planName: 'Pro',
            planType: 'paid',
            currentPeriodStart: null,
            currentPeriodEnd: null,
            openmeterSubscriptionId: null,
            stripeCheckoutSessionId: null,
            createdAt: '2026-01-01T00:00:00.000Z',
            cancelledAt: null,
          },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  resetPymthouseCapabilityCacheForTests();
  delete process.env.PYMTHOUSE_CAPABILITY_CACHE_TTL_MS;
});

afterEach(() => {
  vi.restoreAllMocks();
  resetPymthouseCapabilityCacheForTests();
});

describe('resolvePymthouseCapabilities — live mapping (O1: keyed on externalUserId)', () => {
  it('delegated MVP (no subscription) → wildcard, no product lookup', async () => {
    getUserSubscription.mockResolvedValue(subscription(null));

    const res = await resolvePymthouseCapabilities(ACCOUNT);

    expect(getUserSubscription).toHaveBeenCalledWith(ACCOUNT);
    expect(listBillingProducts).not.toHaveBeenCalled();
    expect(res.capabilities).toEqual(['*']);
    expect(res.quota).toBeNull();
    expect(res.source).toBe('delegated');
  });

  it('subscription without a planId → wildcard (delegated MVP), surfaces subscriptionRef', async () => {
    getUserSubscription.mockResolvedValue({
      externalUserId: ACCOUNT,
      subscription: { id: 'sub_local_1', status: 'active', planId: null, createdAt: 'x' },
    });

    const res = await resolvePymthouseCapabilities(ACCOUNT);
    expect(res.capabilities).toEqual(['*']);
    expect(res.subscriptionRef).toBe('sub_local_1');
  });

  it('subscription bound to a plan → maps plan capability bundles to <pipeline>:<model>', async () => {
    getUserSubscription.mockResolvedValue(subscription('plan_pro'));
    listBillingProducts.mockResolvedValue({
      apiVersion: 1,
      products: [
        {
          id: 'plan_free',
          capabilities: [{ pipeline: 'text-to-image', modelId: 'sdxl' }],
        },
        {
          id: 'plan_pro',
          capabilities: [
            { pipeline: 'text-to-image', modelId: 'flux-dev' },
            { pipeline: 'live-video-to-video', modelId: 'scope' },
            // malformed rows are dropped by normalization
            { pipeline: '', modelId: 'x' },
            { pipeline: 'text-to-image', modelId: 'flux-dev' }, // duplicate
          ],
        },
      ],
    });

    const res = await resolvePymthouseCapabilities(ACCOUNT);

    expect(res.source).toBe('plan');
    expect(res.capabilities).toEqual([
      'text-to-image:flux-dev',
      'live-video-to-video:scope',
    ]);
    expect(res.subscriptionRef).toBe('sub_local_1');
  });

  it('subscription whose plan cannot be resolved → fail closed ([]), key still valid', async () => {
    getUserSubscription.mockResolvedValue(subscription('plan_ghost'));
    listBillingProducts.mockResolvedValue({ apiVersion: 1, products: [{ id: 'plan_other', capabilities: [] }] });

    const res = await resolvePymthouseCapabilities(ACCOUNT);
    expect(res.capabilities).toEqual([]);
    expect(res.source).toBe('plan_unresolved');
  });

  it('provider error PROPAGATES (front door fails closed) — never treated as all-caps', async () => {
    getUserSubscription.mockRejectedValue(new Error('provider down'));
    await expect(resolvePymthouseCapabilities(ACCOUNT)).rejects.toThrow('provider down');
  });
});

describe('resolvePymthouseCapabilities — short-TTL cache (per-account, tenant-scoped)', () => {
  it('cache hit: a second call within TTL does not re-hit the provider', async () => {
    getUserSubscription.mockResolvedValue(subscription(null));

    await resolvePymthouseCapabilities(ACCOUNT);
    await resolvePymthouseCapabilities(ACCOUNT);

    expect(getUserSubscription).toHaveBeenCalledTimes(1);
  });

  it('cache miss: a different account is resolved independently (no cross-tenant leak)', async () => {
    getUserSubscription.mockResolvedValue(subscription(null));

    await resolvePymthouseCapabilities('acct_a');
    await resolvePymthouseCapabilities('acct_b');

    expect(getUserSubscription).toHaveBeenCalledTimes(2);
    expect(getUserSubscription).toHaveBeenNthCalledWith(1, 'acct_a');
    expect(getUserSubscription).toHaveBeenNthCalledWith(2, 'acct_b');
  });

  it('skipCache forces a fresh provider call', async () => {
    getUserSubscription.mockResolvedValue(subscription(null));

    await resolvePymthouseCapabilities(ACCOUNT);
    await resolvePymthouseCapabilities(ACCOUNT, { skipCache: true });

    expect(getUserSubscription).toHaveBeenCalledTimes(2);
  });

  it('TTL=0 disables caching (every call re-hits the provider)', async () => {
    process.env.PYMTHOUSE_CAPABILITY_CACHE_TTL_MS = '0';
    getUserSubscription.mockResolvedValue(subscription(null));

    await resolvePymthouseCapabilities(ACCOUNT);
    await resolvePymthouseCapabilities(ACCOUNT);

    expect(getUserSubscription).toHaveBeenCalledTimes(2);
  });
});
