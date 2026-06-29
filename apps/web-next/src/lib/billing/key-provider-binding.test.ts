/** @vitest-environment node */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const resolveSubscriptionForKey = vi.fn();
vi.mock('./subscription', () => ({
  resolveSubscriptionForKey: (...a: unknown[]) => resolveSubscriptionForKey(...a),
}));

const resolveAdapterForProviderInstanceById = vi.fn();
vi.mock('./registry-db', () => ({
  resolveAdapterForProviderInstanceById: (...a: unknown[]) =>
    resolveAdapterForProviderInstanceById(...a),
}));

import { resolveKeyProviderBinding } from './key-provider-binding';

function fakeAdapter() {
  return { slug: 'pymthouse', isConfigured: () => true, mintSignerSession: vi.fn() };
}

const sub = {
  id: 'sub-1',
  teamId: 'team-1',
  providerInstanceId: 'inst-1',
  providerPlanId: null,
  accountId: 'acct_sub_42',
  status: 'active',
  appId: null,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('resolveKeyProviderBinding — legacy passthrough (zero regression)', () => {
  it('flag OFF → legacy; never resolves an instance adapter', async () => {
    resolveSubscriptionForKey.mockResolvedValue({ mode: 'legacy', reason: 'flag_off' });
    const r = await resolveKeyProviderBinding({ subscriptionId: 'sub-1', teamId: 'team-1' });
    expect(r).toEqual({ mode: 'legacy', reason: 'flag_off' });
    expect(resolveAdapterForProviderInstanceById).not.toHaveBeenCalled();
  });

  it('null subscriptionId → legacy (no_subscription)', async () => {
    resolveSubscriptionForKey.mockResolvedValue({ mode: 'legacy', reason: 'no_subscription' });
    const r = await resolveKeyProviderBinding({ subscriptionId: null, teamId: 'team-1' });
    expect(r).toEqual({ mode: 'legacy', reason: 'no_subscription' });
    expect(resolveAdapterForProviderInstanceById).not.toHaveBeenCalled();
  });

  it('missing/inactive subscription → legacy (fail closed)', async () => {
    resolveSubscriptionForKey.mockResolvedValue({ mode: 'legacy', reason: 'subscription_inactive' });
    const r = await resolveKeyProviderBinding({ subscriptionId: 'sub-1', teamId: 'team-1' });
    expect(r).toEqual({ mode: 'legacy', reason: 'subscription_inactive' });
  });
});

describe('resolveKeyProviderBinding — isolation + fallback', () => {
  it('subscription belonging to another team → legacy (team_mismatch)', async () => {
    resolveSubscriptionForKey.mockResolvedValue({ mode: 'subscription', subscription: sub });
    const r = await resolveKeyProviderBinding({ subscriptionId: 'sub-1', teamId: 'team-OTHER' });
    expect(r).toEqual({ mode: 'legacy', reason: 'team_mismatch' });
    expect(resolveAdapterForProviderInstanceById).not.toHaveBeenCalled();
  });

  it('unresolved instance adapter → legacy (instance_unresolved)', async () => {
    resolveSubscriptionForKey.mockResolvedValue({ mode: 'subscription', subscription: sub });
    resolveAdapterForProviderInstanceById.mockResolvedValue({
      adapter: undefined,
      source: 'instance-missing-default-env',
      providerInstanceId: null,
      adapterType: 'pymthouse',
    });
    const r = await resolveKeyProviderBinding({ subscriptionId: 'sub-1', teamId: 'team-1' });
    expect(r).toEqual({ mode: 'legacy', reason: 'instance_unresolved' });
  });
});

describe('resolveKeyProviderBinding — per-instance/per-account resolution', () => {
  it('active, same-team subscription → subscription mode scoped to {instance, account}', async () => {
    const adapter = fakeAdapter();
    resolveSubscriptionForKey.mockResolvedValue({ mode: 'subscription', subscription: sub });
    resolveAdapterForProviderInstanceById.mockResolvedValue({
      adapter,
      source: 'instance',
      providerInstanceId: 'inst-1',
      adapterType: 'pymthouse',
    });

    const r = await resolveKeyProviderBinding({ subscriptionId: 'sub-1', teamId: 'team-1' });

    // Instance resolution is scoped to the key's team (provider_instances flag).
    expect(resolveAdapterForProviderInstanceById).toHaveBeenCalledWith('inst-1', undefined, 'team-1');
    expect(r.mode).toBe('subscription');
    if (r.mode !== 'subscription') throw new Error('expected subscription');
    expect(r.adapter).toBe(adapter);
    // billingAccountRef points at the subscription's account, provider = adapterType.
    expect(r.billingAccountRef).toEqual({ providerSlug: 'pymthouse', accountId: 'acct_sub_42' });
    expect(r.subscription.id).toBe('sub-1');
  });
});
