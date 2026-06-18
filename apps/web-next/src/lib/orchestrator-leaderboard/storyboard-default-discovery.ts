/**
 * NAAP-9 — Storyboard Default discovery builder.
 *
 * Pure(ish) orchestration of the default plan: union ClickHouse results across
 * each category's capabilities, merge the static-fleet fallback per category,
 * apply the provider denylist (pymthouse only), dedupe, and tier-shuffle into
 * the bare `[{ address }]` discovery payload.
 *
 * The fetch step is injected (`fetchCapabilityAddresses`) so this module stays
 * unit-testable without ClickHouse and so the golden-set parity test can mock
 * the leaderboard per capability.
 */

import {
  STORYBOARD_DEFAULT_CATEGORY_KEYS,
  STORYBOARD_DEFAULT_PLAN,
  type StoryboardDefaultCategory,
  type StoryboardDefaultCategoryKey,
  type StoryboardDefaultPlan,
} from './storyboard-default-plan';
import { mergeStaticFleet, staticFleetGaps } from './static-fleet';
import {
  tieredShuffleDiscoveryAddresses,
  tieredShuffleWithStaticFallback,
  type RandomSource,
} from './discovery-order';
import { isCapabilityAllowedForProvider } from './provider-restrictions';

/** Result of fetching one capability's ranked orchestrators. */
export interface CapabilityFetchResult {
  addresses: string[];
  fromCache: boolean;
  cachedAt: number;
}

export type FetchCapabilityAddresses = (
  leaderboardCap: string,
) => Promise<CapabilityFetchResult>;

export interface StoryboardDefaultByKind {
  /** Scope ORCHESTRATOR addresses (identity matters): live + static fleet. */
  scope: string[];
  /** BYOC CAPABILITIES included after the provider denylist. */
  byoc: string[];
  /** Tool CAPABILITIES included after the provider denylist. */
  tool: string[];
}

export interface StoryboardDefaultDiscoveryResult {
  /** Flattened, tier-shuffled discovery payload addresses. */
  addresses: string[];
  byKind: StoryboardDefaultByKind;
  meta: {
    fromCache: boolean;
    cacheAgeMs: number;
    staticFleetInjected: number;
  };
}

export interface BuildStoryboardDefaultDiscoveryArgs {
  fetchCapabilityAddresses: FetchCapabilityAddresses;
  /** Resolved billing provider slug; pymthouse triggers the denylist. */
  billingProviderSlug?: string | null;
  plan?: StoryboardDefaultPlan;
  topN?: number;
  random?: RandomSource;
  /**
   * NAAP-3: discovery-driven capability lists per category. The builder is
   * SOURCE-AGNOSTIC: when this is omitted (the default), each category uses its
   * committed plan baseline — byte-for-byte identical to today, so the golden
   * set is preserved. When provided (the BYOC/tool discovery flag is ON), the
   * given categories use the discovery-driven capability list instead of the
   * hardcoded constants. `staticOrchestrators` always come from the plan.
   */
  categoryCapabilities?: Partial<Record<StoryboardDefaultCategoryKey, readonly string[]>>;
}

/** Split a full cap path into the short leaderboard capability (after `/`). */
function leaderboardCapFromPath(raw: string): string {
  const value = raw.trim();
  const slash = value.lastIndexOf('/');
  return slash >= 0 ? value.slice(slash + 1).trim() : value;
}

/**
 * Collect live, ranked addresses for a category's capabilities, honoring the
 * provider denylist. Returns the discovered addresses plus the list of caps
 * that were actually queried (provider-allowed).
 */
async function collectCategory(
  category: StoryboardDefaultCategory,
  billingProviderSlug: string | null | undefined,
  fetchCapabilityAddresses: FetchCapabilityAddresses,
  topN: number,
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
    if (!isCapabilityAllowedForProvider(raw, billingProviderSlug)) {
      continue;
    }
    allowedCapabilities.push(raw);

    const leaderboardCap = leaderboardCapFromPath(raw);
    const result = await fetchCapabilityAddresses(leaderboardCap);
    fromCache = fromCache && result.fromCache;
    cacheAgeMs = Math.max(cacheAgeMs, Date.now() - result.cachedAt);

    for (const addr of result.addresses) {
      const address = addr.trim();
      if (!address || seen.has(address)) {
        continue;
      }
      seen.add(address);
      discovered.push(address);
      if (discovered.length >= topN) {
        break;
      }
    }
    if (discovered.length >= topN) {
      break;
    }
  }

  return { discovered, allowedCapabilities, fromCache, cacheAgeMs };
}

/**
 * Build the Storyboard Default discovery bundle.
 *
 * - scope: live + static-fleet merge (static fleet joins the tier shuffle),
 *   guaranteeing all known staging orchs (incl. orch-staging-3) are present.
 * - byoc/tool: union of live results across caps + their static fleet.
 * - provider denylist applied only when `billingProviderSlug === 'pymthouse'`.
 */
export async function buildStoryboardDefaultDiscovery(
  args: BuildStoryboardDefaultDiscoveryArgs,
): Promise<StoryboardDefaultDiscoveryResult> {
  const plan = args.plan ?? STORYBOARD_DEFAULT_PLAN;
  const topN = args.topN ?? plan.topN;
  const random = args.random;
  const provider = args.billingProviderSlug ?? null;

  let fromCache = true;
  let cacheAgeMs = 0;
  let staticFleetInjected = 0;

  const perCategoryAddresses: Record<StoryboardDefaultCategoryKey, string[]> = {
    scope: [],
    byoc: [],
    tool: [],
  };
  const byKind: StoryboardDefaultByKind = { scope: [], byoc: [], tool: [] };

  for (const key of STORYBOARD_DEFAULT_CATEGORY_KEYS) {
    const baseCategory = plan[key];
    // NAAP-3: when a discovery-driven capability list is supplied for this
    // category, use it in place of the hardcoded plan constants (static-fleet
    // fallback is unchanged). Omitted → plan baseline → golden-set parity.
    const overrideCapabilities = args.categoryCapabilities?.[key];
    const category: StoryboardDefaultCategory = overrideCapabilities
      ? { capabilities: overrideCapabilities, staticOrchestrators: baseCategory.staticOrchestrators }
      : baseCategory;
    const collected = await collectCategory(
      category,
      provider,
      args.fetchCapabilityAddresses,
      topN,
    );
    fromCache = fromCache && collected.fromCache;
    cacheAgeMs = Math.max(cacheAgeMs, collected.cacheAgeMs);

    const staticFleet = [...category.staticOrchestrators];
    staticFleetInjected += staticFleetGaps(collected.discovered, staticFleet).length;

    const merged = mergeStaticFleet(collected.discovered, staticFleet);
    perCategoryAddresses[key] = merged;

    if (key === 'scope') {
      // Scope identity matters: report the merged orchestrator addresses.
      byKind.scope = merged;
    } else {
      // byoc/tool: the capability set that was included is what parity checks.
      byKind[key] = collected.allowedCapabilities;
    }
  }

  // Scope addresses get static fleet shuffled in; flatten all categories.
  const scopeShuffled = tieredShuffleWithStaticFallback(
    perCategoryAddresses.scope,
    [],
    random ? { random } : undefined,
  );
  const flattened = [
    ...scopeShuffled,
    ...perCategoryAddresses.byoc,
    ...perCategoryAddresses.tool,
  ];
  const addresses = tieredShuffleDiscoveryAddresses(
    flattened,
    random ? { random } : undefined,
  );

  return {
    addresses,
    byKind,
    meta: { fromCache, cacheAgeMs, staticFleetInjected },
  };
}
