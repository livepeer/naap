import { describe, it, expect } from 'vitest';
import {
  SIGNER_BUNDLE_PLAN_BILLING_IDS,
  signerBundleSlugForPlanBillingId,
} from '../signer-bundle-plan-ids';

describe('signerBundleSlugForPlanBillingId', () => {
  it('maps seeded public plan billing ids onto bundle slugs', () => {
    expect(signerBundleSlugForPlanBillingId('naap-default-daydream-byoc')).toBe(
      'daydream-byoc',
    );
    expect(
      signerBundleSlugForPlanBillingId('naap-default-pymthouse-live-runner'),
    ).toBe('pymthouse-live-runner');
  });

  it('returns null for unrelated plans', () => {
    expect(signerBundleSlugForPlanBillingId('naap-default-max-avail')).toBeNull();
    expect(signerBundleSlugForPlanBillingId('custom-plan')).toBeNull();
  });

  it('exposes exactly the two signer-bundle plan ids', () => {
    expect(Object.keys(SIGNER_BUNDLE_PLAN_BILLING_IDS).sort()).toEqual([
      'naap-default-daydream-byoc',
      'naap-default-pymthouse-live-runner',
    ]);
  });
});
