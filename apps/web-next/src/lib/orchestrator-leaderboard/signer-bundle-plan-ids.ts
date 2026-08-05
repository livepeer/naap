/**
 * Maps public DiscoveryPlan.billingPlanId values (seeded by
 * bin/seed-discovery-plans.ts) onto signer-bundle slugs so
 * /plans/{id}/python-gateway can serve the same shortlist as
 * /bundles/{slug}/python-gateway.
 */

import type { SignerBundleSlug } from './signer-bundle-types';

/** Seeded billingPlanId → signer bundle slug. */
export const SIGNER_BUNDLE_PLAN_BILLING_IDS: Record<string, SignerBundleSlug> = {
  'naap-default-daydream-byoc': 'daydream-byoc',
  'naap-default-pymthouse-live-runner': 'pymthouse-live-runner',
};

export function signerBundleSlugForPlanBillingId(
  billingPlanId: string,
): SignerBundleSlug | null {
  return SIGNER_BUNDLE_PLAN_BILLING_IDS[billingPlanId] ?? null;
}
