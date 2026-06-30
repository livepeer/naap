/**
 * Canary discovery seam — tests for the parameterized canary orchestrator
 * injection and the cron-independent fail-safe added on top of the NAAP-9
 * Storyboard Default bundle.
 *
 * Guarantees:
 *  - With no canary env (the default) the bundle is byte-for-byte unchanged
 *    (zero regression; the golden-set parity test still owns the baseline).
 *  - When the per-class env vars are set, the canary orchestrator surfaces in
 *    ALL THREE capability classes (scope + byoc + tool) it is configured for.
 *  - A ClickHouse/leaderboard fetch failure degrades to the static fleet
 *    (incl. the canary) instead of throwing — so the bundle does NOT depend on
 *    the global leaderboard dataset cron.
 */

import { afterEach, describe, expect, it } from 'vitest';

import {
  buildStoryboardDefaultDiscovery,
  type CapabilityFetchResult,
} from './storyboard-default-discovery';
import {
  resolveAllCanaryStaticOrchestrators,
  resolveCanaryStaticOrchestrators,
  STORYBOARD_CANARY_ORCHESTRATOR_ENV,
} from './storyboard-default-plan';

const CANARY = 'https://byoc-canary-1.daydream.monster:8935';

/** Leaderboard mock: scope returns staging-1/2; everything else returns the BYOC host. */
function fetchOk(): (cap: string) => Promise<CapabilityFetchResult> {
  return async (cap: string): Promise<CapabilityFetchResult> => ({
    addresses:
      cap === 'scope'
        ? [
            'https://orch-staging-1.daydream.monster:8935',
            'https://orch-staging-2.daydream.monster:8935',
          ]
        : ['https://byoc-staging-1.daydream.monster:8935'],
    fromCache: true,
    cachedAt: Date.now(),
  });
}

describe('canary static-orchestrator injection', () => {
  it('injects the canary into scope, byoc, and tool when configured for all three', async () => {
    const result = await buildStoryboardDefaultDiscovery({
      fetchCapabilityAddresses: fetchOk(),
      billingProviderSlug: 'daydream',
      canaryStaticOrchestrators: { scope: [CANARY], byoc: [CANARY], tool: [CANARY] },
    });

    // Scope reports merged orchestrator addresses → canary present.
    expect(result.byKind.scope).toContain(CANARY);
    // The flattened payload (what python-gateway returns) contains the canary.
    expect(result.addresses).toContain(CANARY);
    // De-duplicated: the canary appears exactly once even though it was added
    // to all three classes.
    expect(result.addresses.filter((a) => a === CANARY)).toHaveLength(1);
    // Baseline static hosts are still present.
    expect(result.addresses).toContain('https://orch-staging-3.daydream.monster:8935');
    expect(result.addresses).toContain('https://byoc-staging-1.daydream.monster:8935');
  });

  it('does NOT change the bundle when no canary orchestrators are supplied', async () => {
    const result = await buildStoryboardDefaultDiscovery({
      fetchCapabilityAddresses: fetchOk(),
      billingProviderSlug: 'daydream',
    });
    expect(result.addresses).not.toContain(CANARY);
    expect(result.byKind.scope).toEqual([
      'https://orch-staging-1.daydream.monster:8935',
      'https://orch-staging-2.daydream.monster:8935',
      'https://orch-staging-3.daydream.monster:8935',
    ]);
  });

  it('does not inject the canary for a class whose capabilities are all denied', async () => {
    // pymthouse denylist removes the daydream-only scope/byoc/tool caps, so no
    // capability is allowed → no static fleet (and thus no canary) for any class.
    const result = await buildStoryboardDefaultDiscovery({
      fetchCapabilityAddresses: fetchOk(),
      billingProviderSlug: 'pymthouse',
      canaryStaticOrchestrators: { scope: [CANARY], byoc: [CANARY], tool: [CANARY] },
    });
    expect(result.addresses).not.toContain(CANARY);
  });
});

describe('cron-independent fail-safe', () => {
  it('returns the static fleet (incl. canary) when the leaderboard fetch throws', async () => {
    const throwingFetch = async (): Promise<CapabilityFetchResult> => {
      throw new Error('ClickHouse query failed (503)');
    };

    const result = await buildStoryboardDefaultDiscovery({
      fetchCapabilityAddresses: throwingFetch,
      billingProviderSlug: 'daydream',
      canaryStaticOrchestrators: { byoc: [CANARY], tool: [CANARY] },
    });

    // No throw, and the static fleet + canary are still served.
    expect(result.addresses).toContain(CANARY);
    expect(result.addresses).toContain('https://orch-staging-1.daydream.monster:8935');
    expect(result.addresses).toContain('https://byoc-staging-1.daydream.monster:8935');
  });
});

describe('env resolution', () => {
  const KEYS = STORYBOARD_CANARY_ORCHESTRATOR_ENV;
  const saved: Record<string, string | undefined> = {};

  afterEach(() => {
    for (const name of Object.values(KEYS)) {
      if (saved[name] === undefined) delete process.env[name];
      else process.env[name] = saved[name];
    }
  });

  function setEnv(name: string, value: string | undefined): void {
    if (!(name in saved)) saved[name] = process.env[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }

  it('defaults to empty when env is unset', () => {
    setEnv(KEYS.byoc, undefined);
    expect(resolveCanaryStaticOrchestrators('byoc')).toEqual([]);
    expect(resolveAllCanaryStaticOrchestrators()).toEqual({});
  });

  it('parses a comma-separated list and trims blanks', () => {
    setEnv(KEYS.byoc, ` ${CANARY} , , https://b.example:8935 `);
    setEnv(KEYS.tool, CANARY);
    expect(resolveCanaryStaticOrchestrators('byoc')).toEqual([
      CANARY,
      'https://b.example:8935',
    ]);
    expect(resolveAllCanaryStaticOrchestrators()).toEqual({
      byoc: [CANARY, 'https://b.example:8935'],
      tool: [CANARY],
    });
  });
});
