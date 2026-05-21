/** @vitest-environment node */

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  computeManifestRevision,
  filterPlanCapabilitiesForManifest,
  isLeaderboardCapabilityAllowed,
  isMissingManifestFailOpenEnabled,
  isPipelineModelInManifest,
  parseCapabilityToPipelineModel,
} from '@/lib/pymthouse-manifest';

describe('pymthouse-manifest', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('parseCapability splits on last slash', () => {
    expect(parseCapabilityToPipelineModel('live-video-to-video/streamdiffusion-sdxl')).toEqual({
      pipeline: 'live-video-to-video',
      modelId: 'streamdiffusion-sdxl',
    });
    expect(parseCapabilityToPipelineModel('noop')).toEqual({ pipeline: '', modelId: 'noop' });
  });

  it('isPipelineModelInManifest denies when manifest is missing or empty', () => {
    expect(isPipelineModelInManifest({ capabilities: [] }, 'a', 'b')).toBe(false);
    expect(isPipelineModelInManifest(null, 'a', 'b')).toBe(false);
  });

  it('isPipelineModelInManifest fail-open on empty list only when opt-in env is set', () => {
    vi.stubEnv('PYMTHOUSE_ALLOW_MISSING_MANIFEST_FAIL_OPEN', '1');
    expect(isMissingManifestFailOpenEnabled()).toBe(true);
    expect(isPipelineModelInManifest({ capabilities: [] }, 'a', 'b')).toBe(true);
    expect(isPipelineModelInManifest(null, 'a', 'b')).toBe(true);
  });

  it('wildcard model matches any model in allowed pipeline only', () => {
    const manifest = { capabilities: [{ pipeline: 'llm', modelId: '*' }] };
    expect(isPipelineModelInManifest(manifest, 'llm', 'gpt-4')).toBe(true);
    expect(isPipelineModelInManifest(manifest, 'video', 'gpt-4')).toBe(false);
  });

  it('filterPlanCapabilitiesForManifest keeps only resolved allowlist entries', () => {
    const manifest = {
      capabilities: [{ pipeline: 'llm', modelId: 'm1' }],
      excludedCapabilities: [{ pipeline: 'video', modelId: 'x' }],
    };
    expect(
      filterPlanCapabilitiesForManifest(['llm/m1', 'video/x', 'other/y'], manifest),
    ).toEqual(['llm/m1']);
  });

  it('isLeaderboardCapabilityAllowed uses resolved allowlist', () => {
    const manifest = { capabilities: [{ pipeline: 'p', modelId: 'm' }] };
    expect(isLeaderboardCapabilityAllowed(manifest, 'p/m')).toBe(true);
    // Bare model without slash: empty pipeline does not wildcard-match other pipelines
    expect(isLeaderboardCapabilityAllowed(manifest, 'm')).toBe(false);
    expect(isLeaderboardCapabilityAllowed(manifest, 'other/m')).toBe(false);
  });

  it('isPipelineModelInManifest respects excludedCapabilities', () => {
    const manifest = {
      capabilities: [{ pipeline: 'pipe-a', modelId: 'm1' }],
      excludedCapabilities: [{ pipeline: 'pipe-a', modelId: 'm1' }],
    };
    expect(isPipelineModelInManifest(manifest, 'pipe-a', 'm1')).toBe(false);
    expect(isPipelineModelInManifest(manifest, 'future-pipe', 'new-model')).toBe(false);
  });

  it('matches PymtHouse resolved manifest with pipeline wildcard exclusions', () => {
    const manifest = {
      capabilities: [{ pipeline: 'live-video-to-video', modelId: 'streamdiffusion-sdturbo' }],
      excludedCapabilities: [
        { pipeline: 'audio-to-text', modelId: '*' },
        { pipeline: 'image-to-image', modelId: '*' },
        { pipeline: 'live-video-to-video', modelId: 'streamdiffusion' },
      ],
    };
    expect(
      isLeaderboardCapabilityAllowed(manifest, 'live-video-to-video/streamdiffusion-sdturbo'),
    ).toBe(true);
    expect(isLeaderboardCapabilityAllowed(manifest, 'audio-to-text/openai/whisper-large-v3')).toBe(
      false,
    );
    expect(isLeaderboardCapabilityAllowed(manifest, 'image-to-image/timbrooks/instruct-pix2pix')).toBe(
      false,
    );
    expect(isLeaderboardCapabilityAllowed(manifest, 'live-video-to-video/streamdiffusion')).toBe(
      false,
    );
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
