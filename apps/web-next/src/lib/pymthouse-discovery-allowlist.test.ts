/** @vitest-environment node */

import { describe, expect, it } from 'vitest';

import {
  computeAllowlistRevision,
  filterPlanCapabilitiesForAllowlist,
  isLeaderboardCapabilityAllowed,
  isPipelineModelInAllowlist,
  parseCapabilityToPipelineModel,
} from '@/lib/pymthouse-discovery-allowlist';

describe('pymthouse-discovery-allowlist', () => {
  it('parseCapability splits on last slash', () => {
    expect(parseCapabilityToPipelineModel('live-video-to-video/streamdiffusion-sdxl')).toEqual({
      pipeline: 'live-video-to-video',
      modelId: 'streamdiffusion-sdxl',
    });
    expect(parseCapabilityToPipelineModel('noop')).toEqual({ pipeline: '*', modelId: 'noop' });
  });

  it('isPipelineModelInAllowlist fail-open on empty list', () => {
    expect(isPipelineModelInAllowlist({ capabilities: [] }, 'a', 'b')).toBe(true);
    expect(isPipelineModelInAllowlist(null, 'a', 'b')).toBe(true);
  });

  it('wildcard model matches any model in pipeline', () => {
    const allowlist = { capabilities: [{ pipeline: 'llm', modelId: '*' }] };
    expect(isPipelineModelInAllowlist(allowlist, 'llm', 'gpt-4')).toBe(true);
    expect(isPipelineModelInAllowlist(allowlist, 'video', 'gpt-4')).toBe(false);
  });

  it('filterPlanCapabilitiesForAllowlist drops disallowed caps', () => {
    const allowlist = { capabilities: [{ pipeline: 'llm', modelId: 'm1' }] };
    expect(
      filterPlanCapabilitiesForAllowlist(['llm/m1', 'video/x'], allowlist),
    ).toEqual(['llm/m1']);
  });

  it('isLeaderboardCapabilityAllowed uses raw path', () => {
    const allowlist = { capabilities: [{ pipeline: 'p', modelId: 'm' }] };
    expect(isLeaderboardCapabilityAllowed(allowlist, 'p/m')).toBe(true);
    expect(isLeaderboardCapabilityAllowed(allowlist, 'm')).toBe(true);
    expect(isLeaderboardCapabilityAllowed(allowlist, 'other/m')).toBe(false);
  });

  it('computeAllowlistRevision changes when excludedCapabilities change', () => {
    const a = {
      capabilities: [{ pipeline: 'p', modelId: 'm' }],
      excludedCapabilities: [{ pipeline: 'x', modelId: 'y' }],
    };
    const b = {
      capabilities: [{ pipeline: 'p', modelId: 'm' }],
      excludedCapabilities: [{ pipeline: 'x', modelId: 'z' }],
    };
    expect(computeAllowlistRevision(a)).not.toBe(computeAllowlistRevision(b));
  });
});
