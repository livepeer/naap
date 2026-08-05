import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../provider-restrictions', () => ({
  isCapabilityAllowedForProvider: vi.fn(() => true),
}));

import { isCapabilityAllowedForProvider } from '../provider-restrictions';
import { buildSignerBundleDiscovery } from '../signer-bundle-discovery';
import { SIGNER_BUNDLE_DEFAULTS } from '../signer-bundle-defaults';
import { mergeSignerBundleForTest } from '../signer-bundle-config';
import type { CapabilityFetchResult } from '../signer-bundle-discovery';

const BYOC = 'https://byoc-staging-1.daydream.monster:8935';
const TOOL = 'https://tool-staging-1.daydream.monster:8935';
const LR = 'https://liverunner-staging-1.daydream.monster:8935';

function emptyFetch(): (cap: string) => Promise<CapabilityFetchResult> {
  return async () => ({ addresses: [], fromCache: true, cachedAt: Date.now() });
}

function hostFetch(host: string): (cap: string) => Promise<CapabilityFetchResult> {
  return async () => ({ addresses: [host], fromCache: false, cachedAt: Date.now() });
}

describe('buildSignerBundleDiscovery', () => {
  beforeEach(() => {
    vi.mocked(isCapabilityAllowedForProvider).mockReturnValue(true);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('daydream-byoc injects BYOC + tool static fleet when ClickHouse is empty', async () => {
    const result = await buildSignerBundleDiscovery({
      bundle: SIGNER_BUNDLE_DEFAULTS['daydream-byoc'],
      fetchCapabilityAddresses: emptyFetch(),
      random: () => 0,
    });
    expect(result.addresses).toContain(BYOC);
    expect(result.addresses).toContain(TOOL);
    expect(result.addresses).not.toContain(LR);
    expect(result.meta.staticFleetInjected).toBeGreaterThan(0);
  });

  it('pymthouse-live-runner injects LR static fleet and excludes BYOC/tool hosts', async () => {
    const result = await buildSignerBundleDiscovery({
      bundle: SIGNER_BUNDLE_DEFAULTS['pymthouse-live-runner'],
      fetchCapabilityAddresses: emptyFetch(),
      random: () => 0,
    });
    expect(result.addresses).toContain(LR);
    expect(result.addresses).not.toContain(BYOC);
    expect(result.addresses).not.toContain(TOOL);
  });

  it('respects provider denylist — empty allowed caps → no static fleet', async () => {
    vi.mocked(isCapabilityAllowedForProvider).mockReturnValue(false);
    const result = await buildSignerBundleDiscovery({
      bundle: SIGNER_BUNDLE_DEFAULTS['pymthouse-live-runner'],
      fetchCapabilityAddresses: hostFetch(LR),
      random: () => 0,
    });
    expect(result.addresses).toEqual([]);
    expect(result.meta.capabilitiesQueried).toBe(0);
  });

  it('filters by caps= short name', async () => {
    const fetch = vi.fn(hostFetch(BYOC));
    const result = await buildSignerBundleDiscovery({
      bundle: SIGNER_BUNDLE_DEFAULTS['daydream-byoc'],
      fetchCapabilityAddresses: fetch,
      filterCapabilities: ['flux-dev'],
      random: () => 0,
    });
    expect(result.addresses).toContain(BYOC);
    // Only flux-dev (and maybe other matching) — fetch called for flux-dev
    const calledCaps = fetch.mock.calls.map((c) => c[0]);
    expect(calledCaps).toContain('flux-dev');
    expect(calledCaps).not.toContain('ffmpeg-concat');
  });

  it('disabled bundle returns empty addresses', async () => {
    const bundle = mergeSignerBundleForTest('daydream-byoc', { slug: 'daydream-byoc', enabled: false });
    const result = await buildSignerBundleDiscovery({
      bundle,
      fetchCapabilityAddresses: hostFetch(BYOC),
    });
    expect(result.addresses).toEqual([]);
  });

  it('admin category override can drop tool from daydream-byoc', async () => {
    const bundle = mergeSignerBundleForTest('daydream-byoc', {
      slug: 'daydream-byoc',
      categories: ['byoc'],
    });
    const result = await buildSignerBundleDiscovery({
      bundle,
      fetchCapabilityAddresses: emptyFetch(),
      random: () => 0,
    });
    expect(result.addresses).toContain(BYOC);
    expect(result.addresses).not.toContain(TOOL);
  });

  it('honors topN', async () => {
    const result = await buildSignerBundleDiscovery({
      bundle: SIGNER_BUNDLE_DEFAULTS['daydream-byoc'],
      fetchCapabilityAddresses: emptyFetch(),
      topN: 1,
      random: () => 0,
    });
    expect(result.addresses).toHaveLength(1);
  });
});
