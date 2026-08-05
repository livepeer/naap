/**
 * Build a plane-scoped orchestrator shortlist for a signer discovery bundle.
 *
 * Reuses static-fleet + tier-shuffle helpers from storyboard-default discovery
 * without changing that path. Response is orch URIs only (python-gateway shape).
 */

import type { StoryboardDefaultCategory } from './storyboard-default-plan';
import { mergeStaticFleet, staticFleetGaps } from './static-fleet';
import {
  tieredShuffleDiscoveryAddresses,
  type RandomSource,
} from './discovery-order';
import { isCapabilityAllowedForProvider } from './provider-restrictions';
import type { SignerDiscoveryBundle, SignerBundleCategory } from './signer-bundle-types';

export interface CapabilityFetchResult {
  addresses: string[];
  fromCache: boolean;
  cachedAt: number;
}

export type FetchCapabilityAddresses = (
  leaderboardCap: string,
) => Promise<CapabilityFetchResult>;

export interface SignerBundleDiscoveryResult {
  addresses: string[];
  meta: {
    fromCache: boolean;
    cacheAgeMs: number;
    staticFleetInjected: number;
    categoriesQueried: SignerBundleCategory[];
    capabilitiesQueried: number;
  };
}

export interface BuildSignerBundleDiscoveryArgs {
  bundle: SignerDiscoveryBundle;
  fetchCapabilityAddresses: FetchCapabilityAddresses;
  /** When set, only collect addresses for these short/full capability names. */
  filterCapabilities?: string[];
  topN?: number;
  random?: RandomSource;
}

function leaderboardCapFromPath(raw: string): string {
  const value = raw.trim();
  const slash = value.lastIndexOf('/');
  return slash >= 0 ? value.slice(slash + 1).trim() : value;
}

function resolveCategory(
  bundle: SignerDiscoveryBundle,
  key: SignerBundleCategory,
): StoryboardDefaultCategory {
  const capabilities = bundle.categoryCapabilities?.[key] ?? [];
  const staticOrchestrators = bundle.categoryStaticOrchestrators?.[key] ?? [];
  return { capabilities, staticOrchestrators };
}

function matchesFilter(rawCap: string, filter?: string[]): boolean {
  if (!filter || filter.length === 0) return true;
  const short = leaderboardCapFromPath(rawCap);
  return filter.some((f) => {
    const needle = f.trim();
    if (!needle) return false;
    return needle === rawCap || needle === short || leaderboardCapFromPath(needle) === short;
  });
}

async function collectCategory(
  category: StoryboardDefaultCategory,
  billingProviderSlug: string,
  fetchCapabilityAddresses: FetchCapabilityAddresses,
  topN: number,
  filterCapabilities?: string[],
): Promise<{
  discovered: string[];
  allowedCapabilities: string[];
  fromCache: boolean;
  cacheAgeMs: number;
}> {
  const discovered: string[] = [];
  const seen = new Set<string>();
  const allowedCapabilities: string[] = [];
  let fromCache = true;
  let cacheAgeMs = 0;

  for (const raw of category.capabilities) {
    if (!matchesFilter(raw, filterCapabilities)) continue;
    if (!isCapabilityAllowedForProvider(raw, billingProviderSlug)) continue;
    allowedCapabilities.push(raw);

    const leaderboardCap = leaderboardCapFromPath(raw);
    const result = await fetchCapabilityAddresses(leaderboardCap);
    fromCache = fromCache && result.fromCache;
    cacheAgeMs = Math.max(cacheAgeMs, Date.now() - result.cachedAt);

    for (const addr of result.addresses) {
      const address = addr.trim();
      if (!address || seen.has(address)) continue;
      seen.add(address);
      discovered.push(address);
      if (discovered.length >= topN) break;
    }
    if (discovered.length >= topN) break;
  }

  return { discovered, allowedCapabilities, fromCache, cacheAgeMs };
}

/**
 * Build the orchestrator address list for one signer bundle.
 * Disabled bundles return an empty list (caller may 404 separately).
 */
export async function buildSignerBundleDiscovery(
  args: BuildSignerBundleDiscoveryArgs,
): Promise<SignerBundleDiscoveryResult> {
  const { bundle, fetchCapabilityAddresses, filterCapabilities, random } = args;
  const topN = args.topN ?? bundle.topN;

  if (!bundle.enabled) {
    return {
      addresses: [],
      meta: {
        fromCache: true,
        cacheAgeMs: 0,
        staticFleetInjected: 0,
        categoriesQueried: [],
        capabilitiesQueried: 0,
      },
    };
  }

  let fromCache = true;
  let cacheAgeMs = 0;
  let staticFleetInjected = 0;
  let capabilitiesQueried = 0;
  const flattened: string[] = [];
  const seen = new Set<string>();

  for (const key of bundle.categories) {
    const category = resolveCategory(bundle, key);
    const collected = await collectCategory(
      category,
      bundle.billingProviderSlug,
      fetchCapabilityAddresses,
      topN,
      filterCapabilities,
    );
    fromCache = fromCache && collected.fromCache;
    cacheAgeMs = Math.max(cacheAgeMs, collected.cacheAgeMs);
    capabilitiesQueried += collected.allowedCapabilities.length;

    // Match storyboard-default: inject static fleet only when at least one
    // provider-allowed capability was queried for this category.
    const staticFleet =
      collected.allowedCapabilities.length > 0 ? [...category.staticOrchestrators] : [];
    staticFleetInjected += staticFleetGaps(collected.discovered, staticFleet).length;

    const merged = mergeStaticFleet(collected.discovered, staticFleet);
    for (const addr of merged) {
      if (seen.has(addr)) continue;
      seen.add(addr);
      flattened.push(addr);
      if (flattened.length >= topN) break;
    }
    if (flattened.length >= topN) break;
  }

  const addresses = tieredShuffleDiscoveryAddresses(
    flattened.slice(0, topN),
    random ? { random } : undefined,
  );

  return {
    addresses,
    meta: {
      fromCache,
      cacheAgeMs,
      staticFleetInjected,
      categoriesQueried: [...bundle.categories],
      capabilitiesQueried,
    },
  };
}
