import type { BillingProviderSlug, DiscoveryPlan } from './types';
import {
  filterPlanCapabilitiesForManifest,
  getPymthouseManifestSnapshot,
  isLeaderboardCapabilityAllowed,
} from '@/lib/pymthouse-manifest';

const SUPPORTED_PROVIDER_SLUGS: ReadonlySet<string> = new Set(['pymthouse', 'daydream']);

export function normalizeBillingProviderSlug(
  slug?: string | null,
): BillingProviderSlug | null {
  const normalized = slug?.trim().toLowerCase();
  if (!normalized || !SUPPORTED_PROVIDER_SLUGS.has(normalized)) {
    return null;
  }
  return normalized as BillingProviderSlug;
}

export function providerRestrictionRevision(
  billingProviderSlug?: string | null,
): string {
  return normalizeBillingProviderSlug(billingProviderSlug) === 'pymthouse'
    ? getPymthouseManifestSnapshot().revision
    : 'na';
}

export function resolvePlanCapabilitiesForProvider(
  plan: Pick<DiscoveryPlan, 'billingProviderSlug' | 'capabilities'>,
): string[] {
  return filterCapabilitiesForProvider(plan.capabilities, plan.billingProviderSlug);
}

export function filterCapabilitiesForProvider(
  capabilities: string[],
  billingProviderSlug?: string | null,
): string[] {
  if (normalizeBillingProviderSlug(billingProviderSlug) !== 'pymthouse') {
    return capabilities;
  }
  const manifest = getPymthouseManifestSnapshot().data;
  return filterPlanCapabilitiesForManifest(capabilities, manifest);
}

export function isCapabilityAllowedForProvider(
  capability: string,
  billingProviderSlug?: string | null,
): boolean {
  if (normalizeBillingProviderSlug(billingProviderSlug) !== 'pymthouse') {
    return true;
  }
  return isLeaderboardCapabilityAllowed(
    getPymthouseManifestSnapshot().data,
    capability,
  );
}
