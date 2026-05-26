import type { BillingProviderSlug, DiscoveryPlan } from './types';

// Daydream-only discovery-plan gating. No PymtHouse manifest filtering happens in PR #337.
//
// IMPORTANT — deliberate asymmetry with BILLING_PROVIDER_SLUGS in types.ts:
//   - BILLING_PROVIDER_SLUGS (and CreatePlanSchema) includes 'pymthouse' so that the
//     plan CRUD layer can surface legacy null-slug rows as pymthouse-scoped via the
//     billingProviderWhere OR-null clause.
//   - SUPPORTED_PROVIDER_SLUGS here intentionally excludes 'pymthouse' so that
//     normalizeBillingProviderSlug returns null for it, and any route that uses this
//     normalizer (e.g. /capability-catalog) rejects pymthouse requests with a 400
//     until manifest-gating support lands in PR #338.
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

export function providerRestrictionRevision(
  billingProviderSlug?: string | null,
): string {
  // Stable revision for caching. Daydream has no allowlist/manifest dependency.
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
