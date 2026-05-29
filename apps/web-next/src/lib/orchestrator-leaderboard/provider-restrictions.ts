import type { BillingProviderSlug, DiscoveryPlan } from './types';

// Daydream-only discovery-plan gating. No PymtHouse manifest filtering happens in PR #337.
// PymtHouse support (manifest sync, capability filtering) lands in PR #338.
const SUPPORTED_PROVIDER_SLUGS: ReadonlySet<string> = new Set(['daydream']);

export function normalizeBillingProviderSlug(
  slug?: string | null,
): BillingProviderSlug | null {
  const normalized = slug?.trim().toLowerCase();
  if (!normalized || !SUPPORTED_PROVIDER_SLUGS.has(normalized)) {
    return null;
  }
  return normalized as BillingProviderSlug;
}

export function providerRestrictionRevision(): string {
  // Stable revision for caching. Daydream has no allowlist/manifest dependency.
  // When PymtHouse is added (#338), this will return a manifest-based hash.
  return 'na';
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
  // Daydream does not filter capabilities (no manifest gating).
  return capabilities;
}

export function isCapabilityAllowedForProvider(
  capability: string,
  billingProviderSlug?: string | null,
): boolean {
  // Daydream allows all capabilities by default (no manifest allowlist intersection).
  return true;
}
