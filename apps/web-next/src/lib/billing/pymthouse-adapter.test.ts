/** @vitest-environment node */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fetchUsageForExternalUser = vi.fn();
const getUsage = vi.fn();
const getUserSubscription = vi.fn();
const listBillingProducts = vi.fn();

vi.mock('@/lib/pymthouse-client', () => ({
  getPmtHouseServerClient: () => ({
    fetchUsageForExternalUser,
    getUsage,
    getUserSubscription,
    listBillingProducts,
  }),
}));

vi.mock('@pymthouse/builder-sdk/config', () => ({
  isPymthouseConfigured: () => true,
}));

const isFeatureEnabled = vi.fn();
vi.mock('@/lib/feature-flags', () => ({
  isFeatureEnabled: (...a: unknown[]) => isFeatureEnabled(...a),
  PYMTHOUSE_BPP_VALIDATE_FLAG: 'pymthouse_bpp_validate',
}));

import { PymthouseAdapter } from './pymthouse-adapter';
import { AdapterNotImplementedError } from './adapter';
import { resetPymthouseCapabilityCacheForTests } from './pymthouse-capabilities';

const WINDOW = { startDate: '2026-01-01T00:00:00.000Z', endDate: '2026-01-31T23:59:59.999Z' };

let adapter: PymthouseAdapter;

beforeEach(() => {
  vi.clearAllMocks();
  resetPymthouseCapabilityCacheForTests();
  isFeatureEnabled.mockResolvedValue(false);
  adapter = new PymthouseAdapter();
});

afterEach(() => {
  vi.restoreAllMocks();
  resetPymthouseCapabilityCacheForTests();
});

describe('PymthouseAdapter.validate (BPP ② live capabilities, flag-gated)', () => {
  it('flag OFF → throws AdapterNotImplementedError (zero regression, no provider call)', async () => {
    isFeatureEnabled.mockResolvedValue(false);
    await expect(adapter.validate('acct_om_1')).rejects.toBeInstanceOf(AdapterNotImplementedError);
    expect(getUserSubscription).not.toHaveBeenCalled();
  });

  it('flag ON + delegated account (no subscription) → wildcard capabilities', async () => {
    isFeatureEnabled.mockResolvedValue(true);
    getUserSubscription.mockResolvedValue({ externalUserId: 'acct_om_1', subscription: null });

    const res = await adapter.validate('acct_om_1');
    expect(getUserSubscription).toHaveBeenCalledWith('acct_om_1');
    expect(res.valid).toBe(true);
    expect(res.capabilities).toEqual(['*']);
    expect(res.quota).toBeNull();
  });

  it('flag ON + plan-backed account → mapped, taxonomy-normalized capabilities', async () => {
    isFeatureEnabled.mockResolvedValue(true);
    getUserSubscription.mockResolvedValue({
      externalUserId: 'acct_om_1',
      subscription: { id: 'sub_1', status: 'active', planId: 'plan_pro', createdAt: 'x' },
    });
    listBillingProducts.mockResolvedValue({
      apiVersion: 1,
      products: [
        {
          id: 'plan_pro',
          capabilities: [
            { pipeline: 'text-to-image', modelId: 'flux-dev' },
            { pipeline: 'live-video-to-video', modelId: 'scope' },
          ],
        },
      ],
    });

    const res = await adapter.validate('acct_om_1');
    expect(res.capabilities).toEqual(['text-to-image:flux-dev', 'live-video-to-video:scope']);
    expect(res.subscriptionRef).toBe('sub_1');
  });

  it('flag ON + provider error → propagates (front door fails closed)', async () => {
    isFeatureEnabled.mockResolvedValue(true);
    getUserSubscription.mockRejectedValue(new Error('provider down'));
    await expect(adapter.validate('acct_om_1')).rejects.toThrow('provider down');
  });
});

describe('PymthouseAdapter.getSpend', () => {
  it('scoped pull: asks the provider for ONE external user and maps to a neutral record', async () => {
    fetchUsageForExternalUser.mockResolvedValue({
      clientId: 'app_1',
      period: { start: WINDOW.startDate, end: WINDOW.endDate },
      currentUser: {
        externalUserId: 'acct_self',
        requestCount: 42,
        currency: 'USD',
        networkFeeUsdMicros: '9000',
        ownerChargeUsdMicros: '12000',
        endUserBillableUsdMicros: '15000',
        pipelineModels: [
          {
            pipeline: 'text-to-image',
            modelId: 'sdxl',
            requestCount: 30,
            currency: 'USD',
            networkFeeUsdMicros: '6000',
            ownerChargeUsdMicros: '8000',
            endUserBillableUsdMicros: '10000',
          },
          {
            pipeline: 'live-video',
            modelId: 'lvx',
            requestCount: 12,
            currency: 'USD',
            networkFeeUsdMicros: '3000',
            ownerChargeUsdMicros: '4000',
            endUserBillableUsdMicros: '5000',
          },
        ],
      },
    });

    const result = await adapter.getSpend({ accountId: 'acct_self', ...WINDOW });

    // Tenant boundary: the provider was asked for this one external user only.
    expect(fetchUsageForExternalUser).toHaveBeenCalledWith({
      externalUserId: 'acct_self',
      startDate: WINDOW.startDate,
      endDate: WINDOW.endDate,
    });
    expect(getUsage).not.toHaveBeenCalled();
    expect(result.records).toEqual([
      {
        providerSlug: 'pymthouse',
        accountId: 'acct_self',
        appId: null,
        sessions: 0,
        tickets: 42,
        feeWei: null,
        networkFeeUsdMicros: '9000',
        byCapability: {
          'text-to-image:sdxl': { tickets: 30, networkFeeUsdMicros: '6000' },
          'live-video:lvx': { tickets: 12, networkFeeUsdMicros: '3000' },
        },
      },
    ]);
  });

  it('scoped pull with no pipeline rows omits byCapability', async () => {
    fetchUsageForExternalUser.mockResolvedValue({
      clientId: 'app_1',
      period: { start: WINDOW.startDate, end: WINDOW.endDate },
      currentUser: {
        externalUserId: 'acct_self',
        requestCount: 3,
        currency: 'USD',
        networkFeeUsdMicros: '300',
        ownerChargeUsdMicros: '0',
        endUserBillableUsdMicros: '0',
        pipelineModels: [],
      },
    });

    const result = await adapter.getSpend({ accountId: 'acct_self', ...WINDOW });
    expect('byCapability' in result.records[0]).toBe(false);
  });

  it('app-wide pull: maps one neutral record per app user and surfaces source', async () => {
    getUsage.mockResolvedValue({
      clientId: 'app_1',
      source: 'openmeter',
      period: { start: WINDOW.startDate, end: WINDOW.endDate },
      totals: { requestCount: 50 },
      byUser: [
        { endUserId: 'eu1', externalUserId: 'acct_a', requestCount: 30, feeWei: '1000', networkFeeUsdMicros: '6000' },
        // Unattributed row: Usage API returns endUserId "unknown" + externalUserId null.
        { endUserId: 'unknown', externalUserId: null, requestCount: 20, feeWei: '500', networkFeeUsdMicros: '4000' },
      ],
    });

    const result = await adapter.getSpend({ ...WINDOW });

    expect(getUsage).toHaveBeenCalledWith({ startDate: WINDOW.startDate, endDate: WINDOW.endDate, groupBy: 'user' });
    expect(fetchUsageForExternalUser).not.toHaveBeenCalled();
    expect(result.source).toBe('openmeter');
    expect(result.records).toEqual([
      { providerSlug: 'pymthouse', accountId: 'acct_a', appId: null, sessions: 0, tickets: 30, feeWei: '1000', networkFeeUsdMicros: '6000' },
      { providerSlug: 'pymthouse', accountId: 'unknown', appId: null, sessions: 0, tickets: 20, feeWei: '500', networkFeeUsdMicros: '4000' },
    ]);
  });
});
