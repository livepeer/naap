/** @vitest-environment node */

import { describe, expect, it } from 'vitest';

import {
  computeManifestRevision,
  filterPlanCapabilitiesForManifest,
  isLeaderboardCapabilityAllowed,
  isPipelineModelInManifest,
  parseCapabilityToPipelineModel,
} from '@/lib/pymthouse-manifest';

describe('pymthouse-manifest', () => {
  it('parseCapability splits on last slash', () => {
    expect(parseCapabilityToPipelineModel('live-video-to-video/streamdiffusion-sdxl')).toEqual({
      pipeline: 'live-video-to-video',
      modelId: 'streamdiffusion-sdxl',
    });
    expect(parseCapabilityToPipelineModel('noop')).toEqual({ pipeline: '*', modelId: 'noop' });
  });

  it('isPipelineModelInManifest fail-open on empty list', () => {
    expect(isPipelineModelInManifest({ capabilities: [] }, 'a', 'b')).toBe(true);
    expect(isPipelineModelInManifest(null, 'a', 'b')).toBe(true);
  });

  it('wildcard model matches any model in pipeline', () => {
    const manifest = { capabilities: [{ pipeline: 'llm', modelId: '*' }] };
    expect(isPipelineModelInManifest(manifest, 'llm', 'gpt-4')).toBe(true);
    expect(isPipelineModelInManifest(manifest, 'video', 'gpt-4')).toBe(true);
  });

  it('filterPlanCapabilitiesForManifest drops excluded caps only', () => {
    const manifest = {
      capabilities: [{ pipeline: 'llm', modelId: 'm1' }],
      excludedCapabilities: [{ pipeline: 'video', modelId: 'x' }],
    };
    expect(
      filterPlanCapabilitiesForManifest(['llm/m1', 'video/x', 'other/y'], manifest),
    ).toEqual(['llm/m1', 'other/y']);
  });

  it('isLeaderboardCapabilityAllowed uses raw path', () => {
    const manifest = { capabilities: [{ pipeline: 'p', modelId: 'm' }] };
    expect(isLeaderboardCapabilityAllowed(manifest, 'p/m')).toBe(true);
    expect(isLeaderboardCapabilityAllowed(manifest, 'm')).toBe(true);
    expect(isLeaderboardCapabilityAllowed(manifest, 'other/m')).toBe(true);
  });

  it('isPipelineModelInManifest respects excludedCapabilities', () => {
    const manifest = {
      capabilities: [{ pipeline: 'pipe-a', modelId: 'm1' }],
      excludedCapabilities: [{ pipeline: 'pipe-a', modelId: 'm1' }],
    };
    expect(isPipelineModelInManifest(manifest, 'pipe-a', 'm1')).toBe(false);
    expect(isPipelineModelInManifest(manifest, 'future-pipe', 'new-model')).toBe(true);
  });

  it('computeManifestRevision changes when excludedCapabilities change', () => {
    const a = {
      capabilities: [{ pipeline: 'p', modelId: 'm' }],
      excludedCapabilities: [{ pipeline: 'x', modelId: 'y' }],
    };
    const b = {
      capabilities: [{ pipeline: 'p', modelId: 'm' }],
      excludedCapabilities: [{ pipeline: 'x', modelId: 'z' }],
    };
    expect(computeManifestRevision(a)).not.toBe(computeManifestRevision(b));
  });

  it('uses server manifestVersion when provided', () => {
    const data = {
      capabilities: [{ pipeline: 'p', modelId: 'm' }],
      excludedCapabilities: [] as { pipeline: string; modelId: string }[],
      manifestVersion: 'server-rev-abc',
    };
    expect(computeManifestRevision(data)).not.toBe('server-rev-abc');
  });
});
