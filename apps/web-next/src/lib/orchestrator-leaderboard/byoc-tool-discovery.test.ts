/** @vitest-environment node */

import { describe, it, expect } from 'vitest';

import {
  BYOC_TOOL_DISCOVERY_FLAG,
  isByocToolDiscoveryEnabled,
  resolveByocToolCapabilities,
} from './byoc-tool-discovery';
import {
  buildStoryboardDefaultDiscovery,
  type CapabilityFetchResult,
} from './storyboard-default-discovery';
import { STORYBOARD_DEFAULT_PLAN } from './storyboard-default-plan';

const BASELINE = {
  byoc: ['flux-dev', 'nano-banana'],
  tool: ['ffmpeg-concat', 'pillow-resize'],
};

const benignFetch = async (): Promise<CapabilityFetchResult> => ({
  addresses: ['https://orch.example:8935'],
  fromCache: true,
  cachedAt: Date.now(),
});

describe('NAAP-3 flag — isByocToolDiscoveryEnabled', () => {
  it('exposes the flag name', () => {
    expect(BYOC_TOOL_DISCOVERY_FLAG).toBe('BYOC_TOOL_DISCOVERY_ENABLED');
  });
  it('defaults OFF (absent / arbitrary value)', () => {
    expect(isByocToolDiscoveryEnabled({})).toBe(false);
    expect(isByocToolDiscoveryEnabled({ BYOC_TOOL_DISCOVERY_ENABLED: 'no' })).toBe(false);
  });
  it('is ON only for truthy strings', () => {
    expect(isByocToolDiscoveryEnabled({ BYOC_TOOL_DISCOVERY_ENABLED: 'true' })).toBe(true);
    expect(isByocToolDiscoveryEnabled({ BYOC_TOOL_DISCOVERY_ENABLED: '1' })).toBe(true);
  });
});

describe('NAAP-3 — resolveByocToolCapabilities (discovery-driven)', () => {
  it('classifies discovered caps by family; surfaces new models; excludes scope/unknown', async () => {
    const discover = async () => [
      'flux-dev',
      'flux-pro', // new model under a known byoc family → surfaces with no code change
      'ffmpeg-trim', // new tool under a known tool family
      'pillow-resize',
      'scope', // scope cap → excluded
      'live-video-to-video', // scope pipeline → excluded
      'nano-banana',
    ];
    const result = await resolveByocToolCapabilities({ discover, baseline: BASELINE });
    expect(result.tool).toEqual(['ffmpeg-trim', 'pillow-resize']);
    expect(result.byoc).toEqual(['flux-dev', 'flux-pro', 'nano-banana']);
  });

  it('empty discovery → committed baseline (non-disruptive fallback)', async () => {
    const result = await resolveByocToolCapabilities({ discover: async () => [], baseline: BASELINE });
    expect(result).toEqual({ byoc: [...BASELINE.byoc], tool: [...BASELINE.tool] });
  });

  it('discovery throwing → committed baseline (fail-safe)', async () => {
    const result = await resolveByocToolCapabilities({
      discover: async () => {
        throw new Error('clickhouse down');
      },
      baseline: BASELINE,
    });
    expect(result).toEqual({ byoc: [...BASELINE.byoc], tool: [...BASELINE.tool] });
  });

  it('a category with no discovered members falls back to its baseline', async () => {
    // Only tool caps discovered → byoc falls back to baseline, tool is discovery-driven.
    const result = await resolveByocToolCapabilities({
      discover: async () => ['ffmpeg-concat', 'ffmpeg-overlay'],
      baseline: BASELINE,
    });
    expect(result.tool).toEqual(['ffmpeg-concat', 'ffmpeg-overlay']);
    expect(result.byoc).toEqual([...BASELINE.byoc]);
  });
});

describe('NAAP-3 — builder is source-agnostic', () => {
  it('flag OFF (no override) → byoc/tool == committed plan baseline (golden parity)', async () => {
    const result = await buildStoryboardDefaultDiscovery({
      fetchCapabilityAddresses: benignFetch,
      billingProviderSlug: 'daydream',
    });
    expect(result.byKind.byoc).toEqual([...STORYBOARD_DEFAULT_PLAN.byoc.capabilities]);
    expect(result.byKind.tool).toEqual([...STORYBOARD_DEFAULT_PLAN.tool.capabilities]);
  });

  it('flag ON (override) → byoc/tool driven by the discovery-resolved set; scope untouched', async () => {
    const result = await buildStoryboardDefaultDiscovery({
      fetchCapabilityAddresses: benignFetch,
      billingProviderSlug: 'daydream',
      categoryCapabilities: { byoc: ['flux-dev', 'flux-pro'], tool: ['ffmpeg-concat'] },
    });
    expect(result.byKind.byoc).toEqual(['flux-dev', 'flux-pro']);
    expect(result.byKind.tool).toEqual(['ffmpeg-concat']);
    // scope still resolved from the plan baseline + static fleet
    expect(result.byKind.scope.length).toBeGreaterThan(0);
  });
});
