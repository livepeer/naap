/**
 * Parity / isolation tests for the two signer discovery bundles.
 *
 * Guarantees:
 *   - daydream-byoc ⊇ { byoc-staging-1, tool-staging-1 } and never LR host
 *   - pymthouse-live-runner ⊇ { liverunner-staging-1 } and never BYOC/tool hosts
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../provider-restrictions', () => ({
  isCapabilityAllowedForProvider: vi.fn(() => true),
}));

import { buildSignerBundleDiscovery } from '../signer-bundle-discovery';
import { SIGNER_BUNDLE_DEFAULTS } from '../signer-bundle-defaults';
import { STORYBOARD_DEFAULT_PLAN } from '../storyboard-default-plan';

const BYOC = 'https://byoc-staging-1.daydream.monster:8935';
const TOOL = 'https://tool-staging-1.daydream.monster:8935';
const LR = 'https://liverunner-staging-1.daydream.monster:8935';
const SCOPE = 'https://orch-staging-1.daydream.monster:8935';

describe('signer-bundle parity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('daydream-byoc defaults match STORYBOARD_DEFAULT_PLAN byoc+tool baselines', () => {
    const bundle = SIGNER_BUNDLE_DEFAULTS['daydream-byoc'];
    expect(bundle.billingProviderSlug).toBe('daydream');
    expect(bundle.categories).toEqual(['byoc', 'tool']);
    expect(bundle.categoryCapabilities?.byoc).toEqual([
      ...STORYBOARD_DEFAULT_PLAN.byoc.capabilities,
    ]);
    expect(bundle.categoryCapabilities?.tool).toEqual([
      ...STORYBOARD_DEFAULT_PLAN.tool.capabilities,
    ]);
    expect(bundle.categoryStaticOrchestrators?.byoc).toEqual([
      ...STORYBOARD_DEFAULT_PLAN.byoc.staticOrchestrators,
    ]);
    expect(bundle.categoryStaticOrchestrators?.tool).toEqual([
      ...STORYBOARD_DEFAULT_PLAN.tool.staticOrchestrators,
    ]);
  });

  it('pymthouse-live-runner defaults match STORYBOARD_DEFAULT_PLAN lr baseline', () => {
    const bundle = SIGNER_BUNDLE_DEFAULTS['pymthouse-live-runner'];
    expect(bundle.billingProviderSlug).toBe('pymthouse');
    expect(bundle.categories).toEqual(['lr']);
    expect(bundle.categoryCapabilities?.lr).toEqual([
      ...STORYBOARD_DEFAULT_PLAN.lr.capabilities,
    ]);
    expect(bundle.categoryStaticOrchestrators?.lr).toEqual([
      ...STORYBOARD_DEFAULT_PLAN.lr.staticOrchestrators,
    ]);
  });

  it('daydream-byoc shortlist contains BYOC+tool and excludes LR + scope', async () => {
    const result = await buildSignerBundleDiscovery({
      bundle: SIGNER_BUNDLE_DEFAULTS['daydream-byoc'],
      fetchCapabilityAddresses: async () => ({
        addresses: [],
        fromCache: true,
        cachedAt: Date.now(),
      }),
      random: () => 0,
    });
    expect(result.addresses).toEqual(expect.arrayContaining([BYOC, TOOL]));
    expect(result.addresses).not.toContain(LR);
    expect(result.addresses).not.toContain(SCOPE);
  });

  it('pymthouse-live-runner shortlist contains LR and excludes BYOC+tool+scope', async () => {
    const result = await buildSignerBundleDiscovery({
      bundle: SIGNER_BUNDLE_DEFAULTS['pymthouse-live-runner'],
      fetchCapabilityAddresses: async () => ({
        addresses: [],
        fromCache: true,
        cachedAt: Date.now(),
      }),
      random: () => 0,
    });
    expect(result.addresses).toContain(LR);
    expect(result.addresses).not.toContain(BYOC);
    expect(result.addresses).not.toContain(TOOL);
    expect(result.addresses).not.toContain(SCOPE);
  });

  it('no address appears in both default shortlists (cross-contamination)', async () => {
    const daydream = await buildSignerBundleDiscovery({
      bundle: SIGNER_BUNDLE_DEFAULTS['daydream-byoc'],
      fetchCapabilityAddresses: async () => ({
        addresses: [],
        fromCache: true,
        cachedAt: Date.now(),
      }),
      random: () => 0,
    });
    const lr = await buildSignerBundleDiscovery({
      bundle: SIGNER_BUNDLE_DEFAULTS['pymthouse-live-runner'],
      fetchCapabilityAddresses: async () => ({
        addresses: [],
        fromCache: true,
        cachedAt: Date.now(),
      }),
      random: () => 0,
    });
    const overlap = daydream.addresses.filter((a) => lr.addresses.includes(a));
    expect(overlap).toEqual([]);
  });
});
