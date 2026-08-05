/**
 * Code defaults for signer-bundle discovery.
 *
 * Seeded from STORYBOARD_DEFAULT_PLAN categories so Daydream-BYOC and
 * pymthouse-Live-Runner shortlists stay aligned with the committed staging
 * baseline until an admin override is saved.
 */

import { STORYBOARD_DEFAULT_PLAN } from './storyboard-default-plan';
import type { SignerDiscoveryBundle, SignerBundleSlug } from './signer-bundle-types';

export const SIGNER_BUNDLE_DEFAULTS: Record<SignerBundleSlug, SignerDiscoveryBundle> = {
  'daydream-byoc': {
    slug: 'daydream-byoc',
    name: 'Daydream signer + BYOC/tool orchestrators',
    enabled: true,
    billingProviderSlug: 'daydream',
    categories: ['byoc', 'tool'],
    categoryCapabilities: {
      byoc: [...STORYBOARD_DEFAULT_PLAN.byoc.capabilities],
      tool: [...STORYBOARD_DEFAULT_PLAN.tool.capabilities],
    },
    categoryStaticOrchestrators: {
      byoc: [...STORYBOARD_DEFAULT_PLAN.byoc.staticOrchestrators],
      tool: [...STORYBOARD_DEFAULT_PLAN.tool.staticOrchestrators],
    },
    topN: 100,
  },
  'pymthouse-live-runner': {
    slug: 'pymthouse-live-runner',
    name: 'pymthouse signer + Live Runner orchestrators',
    enabled: true,
    billingProviderSlug: 'pymthouse',
    categories: ['lr'],
    categoryCapabilities: {
      lr: [...STORYBOARD_DEFAULT_PLAN.lr.capabilities],
    },
    categoryStaticOrchestrators: {
      lr: [...STORYBOARD_DEFAULT_PLAN.lr.staticOrchestrators],
    },
    topN: 100,
  },
};

export function listDefaultSignerBundles(): SignerDiscoveryBundle[] {
  return Object.values(SIGNER_BUNDLE_DEFAULTS);
}
