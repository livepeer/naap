/** @vitest-environment node */

import { describe, expect, it } from 'vitest';

import { mapBillingProductToPlan, mapBillingProductsToPlans } from './pymthouse-plans';

describe('mapBillingProductToPlan', () => {
  it('maps active subscription products to BPP plans', () => {
    const plan = mapBillingProductToPlan({
      id: 'plan_pro',
      name: 'Pro',
      type: 'subscription',
      status: 'active',
      priceAmount: '29.00',
      priceCurrency: 'usd',
      allowance: { billingCycle: 'monthly' },
      capabilities: [
        { pipeline: 'text-to-image', modelId: 'flux-dev' },
        { pipeline: 'live-video-to-video', modelId: 'scope' },
      ],
    });
    expect(plan).toEqual({
      id: 'plan_pro',
      name: 'Pro',
      price: { amount: 29, interval: 'month', currency: 'USD' },
      bundles: [
        { capability: 'text-to-image:flux-dev' },
        { capability: 'live-video-to-video:scope' },
      ],
    });
  });

  it('returns null for blank id', () => {
    expect(mapBillingProductToPlan({ id: '  ' })).toBeNull();
  });
});

describe('mapBillingProductsToPlans', () => {
  it('skips inactive products by default', () => {
    const plans = mapBillingProductsToPlans([
      { id: 'plan_active', status: 'active', name: 'A', capabilities: [] },
      { id: 'plan_draft', status: 'draft', name: 'D', capabilities: [] },
    ]);
    expect(plans.map((p) => p.id)).toEqual(['plan_active']);
  });

  it('can include inactive when requested', () => {
    const plans = mapBillingProductsToPlans(
      [{ id: 'plan_draft', status: 'draft', name: 'D', capabilities: [] }],
      { includeInactive: true },
    );
    expect(plans).toHaveLength(1);
  });
});
