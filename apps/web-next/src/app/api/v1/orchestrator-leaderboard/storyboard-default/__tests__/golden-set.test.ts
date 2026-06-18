/**
 * NAAP-9 — Golden-set parity test.
 *
 * "Storyboard default discovery returns the golden BYOC + tool + scope
 * orchestrator set." Guards a non-disruptive Daydream→NaaP discovery switch:
 * the bundle must return ⊇ AND ⊆ the live Daydream set (no orchestrator/cap
 * silently dropped, none silently added). The negative tests prove the assert
 * is bidirectional (catches both missing and extra).
 *
 * Per Decision D7 the golden fixture is snapshotted from the live Daydream path
 * (committed baseline here). fetchLeaderboard is mocked per capability; the
 * scope mock intentionally omits orch-staging-3 to prove the static-fleet
 * fallback re-injects it (catching the staging.json drift).
 */

import { describe, it, expect } from 'vitest';

import {
  buildStoryboardDefaultDiscovery,
  type CapabilityFetchResult,
} from '@/lib/orchestrator-leaderboard/storyboard-default-discovery';
import {
  STORYBOARD_DEFAULT_PLAN,
  type StoryboardDefaultPlan,
} from '@/lib/orchestrator-leaderboard/storyboard-default-plan';
import goldenJson from '../__snapshots__/golden-set.json';

interface GoldenSet {
  scope: string[];
  byoc: string[];
  tool: string[];
}

const golden: GoldenSet = {
  scope: goldenJson.scope,
  byoc: goldenJson.byoc,
  tool: goldenJson.tool,
};

const BYOC_TOOL_STATIC_HOST = 'https://byoc-staging-1.daydream.monster:8935';

/**
 * Mock leaderboard fetch. Scope caps deliberately return only staging-1/2 (the
 * staging.json drift) so the static fleet must re-add staging-3. byoc/tool caps
 * return the BYOC tool host.
 */
function goldenFetch(scopeAddresses: string[]): (cap: string) => Promise<CapabilityFetchResult> {
  return async (_cap: string): Promise<CapabilityFetchResult> => {
    // We can't tell category from the short cap here, so return a benign host
    // for non-scope caps and the (drifted) scope set for the scope cap.
    void _cap;
    const isScope = _cap === 'scope';
    return {
      addresses: isScope ? scopeAddresses : [BYOC_TOOL_STATIC_HOST],
      fromCache: true,
      cachedAt: Date.now(),
    };
  };
}

const SORT = (xs: string[]) => [...xs].sort((a, b) => a.localeCompare(b));

describe('NAAP-9 storyboard-default golden-set parity', () => {
  it('returns the golden scope addresses, byoc caps, and tool caps (bidirectional)', async () => {
    const result = await buildStoryboardDefaultDiscovery({
      // scope mock omits orch-staging-3 → static fleet must re-inject it
      fetchCapabilityAddresses: goldenFetch([
        'https://orch-staging-1.daydream.monster:8935',
        'https://orch-staging-2.daydream.monster:8935',
      ]),
      billingProviderSlug: 'daydream',
    });

    expect(SORT(result.byKind.scope)).toEqual(SORT(golden.scope));
    expect(SORT(result.byKind.byoc)).toEqual(SORT(golden.byoc));
    expect(SORT(result.byKind.tool)).toEqual(SORT(golden.tool));

    // Static-fleet fallback re-injected orch-staging-3 (the drift).
    expect(result.meta.staticFleetInjected).toBeGreaterThanOrEqual(1);

    // The flattened payload contains the golden scope orchestrators.
    for (const addr of golden.scope) {
      expect(result.addresses).toContain(addr);
    }
  });

  it('keeps parity even when ClickHouse returns the full scope set (no drift)', async () => {
    const result = await buildStoryboardDefaultDiscovery({
      fetchCapabilityAddresses: goldenFetch([...golden.scope]),
      billingProviderSlug: 'daydream',
    });
    expect(SORT(result.byKind.scope)).toEqual(SORT(golden.scope));
    expect(result.meta.staticFleetInjected).toBe(0);
  });

  it('fails parity if a golden scope address is removed from both live and static fleet (catches missing)', async () => {
    const planMissingScope: StoryboardDefaultPlan = {
      ...STORYBOARD_DEFAULT_PLAN,
      scope: {
        capabilities: STORYBOARD_DEFAULT_PLAN.scope.capabilities,
        staticOrchestrators: STORYBOARD_DEFAULT_PLAN.scope.staticOrchestrators.filter(
          (a) => !a.includes('orch-staging-3'),
        ),
      },
    };
    const result = await buildStoryboardDefaultDiscovery({
      fetchCapabilityAddresses: goldenFetch([
        'https://orch-staging-1.daydream.monster:8935',
        'https://orch-staging-2.daydream.monster:8935',
      ]),
      billingProviderSlug: 'daydream',
      plan: planMissingScope,
    });
    expect(SORT(result.byKind.scope)).not.toEqual(SORT(golden.scope));
  });

  it('fails parity if a golden byoc cap is removed (catches missing)', async () => {
    const planMissingCap: StoryboardDefaultPlan = {
      ...STORYBOARD_DEFAULT_PLAN,
      byoc: {
        capabilities: STORYBOARD_DEFAULT_PLAN.byoc.capabilities.filter((c) => c !== 'nano-banana'),
        staticOrchestrators: STORYBOARD_DEFAULT_PLAN.byoc.staticOrchestrators,
      },
    };
    const result = await buildStoryboardDefaultDiscovery({
      fetchCapabilityAddresses: goldenFetch([...golden.scope]),
      billingProviderSlug: 'daydream',
      plan: planMissingCap,
    });
    expect(SORT(result.byKind.byoc)).not.toEqual(SORT(golden.byoc));
  });

  it('fails parity if an extra byoc cap is added (catches extra)', async () => {
    const planExtraCap: StoryboardDefaultPlan = {
      ...STORYBOARD_DEFAULT_PLAN,
      byoc: {
        capabilities: [...STORYBOARD_DEFAULT_PLAN.byoc.capabilities, 'rogue-model'],
        staticOrchestrators: STORYBOARD_DEFAULT_PLAN.byoc.staticOrchestrators,
      },
    };
    const result = await buildStoryboardDefaultDiscovery({
      fetchCapabilityAddresses: goldenFetch([...golden.scope]),
      billingProviderSlug: 'daydream',
      plan: planExtraCap,
    });
    expect(SORT(result.byKind.byoc)).not.toEqual(SORT(golden.byoc));
  });

  it('the committed plan baseline matches the golden fixture', () => {
    expect(SORT([...STORYBOARD_DEFAULT_PLAN.byoc.capabilities])).toEqual(SORT(golden.byoc));
    expect(SORT([...STORYBOARD_DEFAULT_PLAN.tool.capabilities])).toEqual(SORT(golden.tool));
    expect(SORT([...STORYBOARD_DEFAULT_PLAN.scope.staticOrchestrators])).toEqual(SORT(golden.scope));
  });
});
