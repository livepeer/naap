/** @vitest-environment node */

import { afterEach, describe, expect, it, vi } from 'vitest';

const getAppManifest = vi.fn();

vi.mock('@/lib/pymthouse-client', () => ({
  getPmtHouseServerClient: vi.fn(() => ({ getAppManifest })),
  resetPmtHouseServerClientForTests: vi.fn(),
}));

import {
  computeManifestRevision,
  filterPlanCapabilitiesForManifest,
  getPymthouseManifestSnapshot,
  isLeaderboardCapabilityAllowed,
  isMissingManifestFailOpenEnabled,
  isPipelineModelInManifest,
  parseCapabilityToPipelineModel,
  resetPymthouseManifestCacheForTests,
  seedPymthouseManifestForTests,
  syncPymthouseManifestSnapshot,
} from '@/lib/pymthouse-manifest';

describe('pymthouse-manifest', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    resetPymthouseManifestCacheForTests();
    vi.restoreAllMocks();
  });

  it('parseCapability splits on last slash', () => {
    expect(parseCapabilityToPipelineModel('live-video-to-video/streamdiffusion-sdxl')).toEqual({
      pipeline: 'live-video-to-video',
      modelId: 'streamdiffusion-sdxl',
    });
    expect(parseCapabilityToPipelineModel('noop')).toEqual({ pipeline: '', modelId: 'noop' });
  });

  it('isPipelineModelInManifest denies when manifest is missing but allows empty exclusion manifests', () => {
    expect(isPipelineModelInManifest({ capabilities: [] }, 'a', 'b')).toBe(true);
    expect(isPipelineModelInManifest(null, 'a', 'b')).toBe(false);
  });

  it('isPipelineModelInManifest fail-open on missing manifest only when opt-in env is set', () => {
    vi.stubEnv('PYMTHOUSE_ALLOW_MISSING_MANIFEST_FAIL_OPEN', '1');
    expect(isMissingManifestFailOpenEnabled()).toBe(true);
    expect(isPipelineModelInManifest({ capabilities: [] }, 'a', 'b')).toBe(true);
    expect(isPipelineModelInManifest(null, 'a', 'b')).toBe(true);
  });

  it('manifest capabilities are informational, not a positive allowlist', () => {
    const manifest = { capabilities: [{ pipeline: 'llm', modelId: '*' }] };
    expect(isPipelineModelInManifest(manifest, 'llm', 'gpt-4')).toBe(true);
    expect(isPipelineModelInManifest(manifest, 'video', 'gpt-4')).toBe(true);
  });

  it('filterPlanCapabilitiesForManifest removes only excluded entries', () => {
    const manifest = {
      capabilities: [{ pipeline: 'llm', modelId: 'm1' }],
      excludedCapabilities: [{ pipeline: 'video', modelId: 'x' }],
    };
    expect(
      filterPlanCapabilitiesForManifest(['llm/m1', 'video/x', 'other/y'], manifest),
    ).toEqual(['llm/m1', 'other/y']);
  });

  it('isLeaderboardCapabilityAllowed allows NaaP capabilities that are not explicitly excluded', () => {
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

  it('applies PymtHouse exclusions while allowing capabilities outside the PymtHouse catalog', () => {
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
    expect(isLeaderboardCapabilityAllowed(manifest, 'text-to-image/black-forest-labs/FLUX.1-dev')).toBe(
      true,
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
    expect(computeManifestRevision(data)).toBe('server-rev-abc');
  });

  it('syncPymthouseManifestSnapshot skips refresh when manifest is not modified', async () => {
    vi.stubEnv('PYMTHOUSE_ISSUER_URL', 'https://pymthouse.example/oidc');
    vi.stubEnv('PYMTHOUSE_PUBLIC_CLIENT_ID', 'app-public');
    vi.stubEnv('PYMTHOUSE_M2M_CLIENT_ID', 'm2m');
    vi.stubEnv('PYMTHOUSE_M2M_CLIENT_SECRET', 'secret');

    seedPymthouseManifestForTests(
      {
        capabilities: [{ pipeline: 'p', modelId: 'm' }],
        manifestVersion: 'rev-1',
      },
      { etag: '"manifest-plan-1"' },
    );

    getAppManifest.mockResolvedValue({
      manifest: null,
      etag: '"manifest-plan-1"',
      notModified: true,
    });

    const result = await syncPymthouseManifestSnapshot();
    expect(result.revisionChanged).toBe(false);
    expect(getAppManifest).toHaveBeenCalledWith({
      ifNoneMatch: '"manifest-plan-1"',
      signal: undefined,
    });
  });

  it('preserves last manifest snapshot when refresh fetch fails', async () => {
    vi.stubEnv('PYMTHOUSE_ISSUER_URL', 'https://pymthouse.example/oidc');
    vi.stubEnv('PYMTHOUSE_PUBLIC_CLIENT_ID', 'app-public');
    vi.stubEnv('PYMTHOUSE_M2M_CLIENT_ID', 'm2m');
    vi.stubEnv('PYMTHOUSE_M2M_CLIENT_SECRET', 'secret');

    seedPymthouseManifestForTests(
      {
        capabilities: [{ pipeline: 'video', modelId: 'model-a' }],
        manifestVersion: 'last-good-rev',
      },
      { etag: '"last-good-etag"' },
    );

    getAppManifest.mockRejectedValue(new Error('network down'));

    const result = await syncPymthouseManifestSnapshot();
    const snapshot = getPymthouseManifestSnapshot();
    expect(result.revision).toBe('last-good-rev');
    expect(result.revisionChanged).toBe(false);
    expect(snapshot.revision).toBe('last-good-rev');
    expect(snapshot.data?.capabilities).toEqual([{ pipeline: 'video', modelId: 'model-a' }]);
  });
});
