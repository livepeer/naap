/**
 * Billing provider adapter registry (NAAP-A).
 *
 * Resolves a provider slug → its `BillingProviderAdapter`. NaaP code looks up a
 * provider here instead of importing a provider client directly.
 *
 * Keyed by provider slug. (The plan's `BillingProvider.adapterType` column is a
 * later refinement; until then `adapterType` defaults to the slug, so the
 * registry is keyed by slug and resolves the same adapter.)
 */

import type { BillingProviderAdapter } from './adapter';
import { PymthouseAdapter } from './pymthouse-adapter';
import { StubAdapter } from './stub-adapter';

function buildDefaultRegistry(): Map<string, BillingProviderAdapter> {
  const adapters: BillingProviderAdapter[] = [new PymthouseAdapter(), new StubAdapter()];
  const map = new Map<string, BillingProviderAdapter>();
  for (const adapter of adapters) {
    map.set(adapter.slug, adapter);
  }
  return map;
}

let registry: Map<string, BillingProviderAdapter> = buildDefaultRegistry();

/** Resolve an adapter by provider slug, or `undefined` if none is registered. */
export function getBillingProviderAdapter(slug: string): BillingProviderAdapter | undefined {
  return registry.get(slug);
}

/** True when an adapter is registered for the slug. */
export function hasBillingProviderAdapter(slug: string): boolean {
  return registry.has(slug);
}

/** The slugs of all registered adapters. */
export function listBillingProviderSlugs(): string[] {
  return Array.from(registry.keys());
}

/**
 * Register (or override) an adapter. Primarily for tests / future dynamic
 * registration; production uses the default registry.
 */
export function registerBillingProviderAdapter(adapter: BillingProviderAdapter): void {
  registry.set(adapter.slug, adapter);
}

/** Reset the registry to its defaults (test isolation). */
export function resetBillingProviderRegistryForTests(): void {
  registry = buildDefaultRegistry();
}
