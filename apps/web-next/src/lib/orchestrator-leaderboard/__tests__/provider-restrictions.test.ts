import { afterEach, describe, expect, it } from 'vitest';
import {
  resetPymthouseManifestCacheForTests,
  seedPymthouseManifestForTests,
} from '@/lib/pymthouse-manifest';
import {
  filterCapabilitiesForProvider,
  isCapabilityAllowedForProvider,
  normalizeBillingProviderSlug,
  providerRestrictionRevision,
  resolvePlanCapabilitiesForProvider,
} from '../provider-restrictions';

describe('provider-restrictions', () => {
  afterEach(() => {
    resetPymthouseManifestCacheForTests();
  });

  it('normalizes supported slugs and rejects unknown values', () => {
    expect(normalizeBillingProviderSlug(' PYMTHOUSE ')).toBe('pymthouse');
    expect(normalizeBillingProviderSlug('daydream')).toBe('daydream');
    expect(normalizeBillingProviderSlug('stripe')).toBeNull();
    expect(normalizeBillingProviderSlug(null)).toBeNull();
  });

  it('uses pymthouse manifest revision when provider is pymthouse', () => {
    seedPymthouseManifestForTests({
      capabilities: [{ pipeline: 'video', modelId: 'model-a' }],
      excludedCapabilities: [],
    });

    expect(providerRestrictionRevision('pymthouse')).not.toBe('na');
    expect(providerRestrictionRevision('daydream')).toBe('na');
  });

  it('filters capabilities by provider exclusion rules', () => {
    seedPymthouseManifestForTests({
      capabilities: [{ pipeline: 'video', modelId: 'model-a' }],
      excludedCapabilities: [{ pipeline: 'video', modelId: 'model-b' }],
    });

    const caps = ['video/model-a', 'video/model-b', 'future/model-c'];
    expect(filterCapabilitiesForProvider(caps, 'pymthouse')).toEqual(['video/model-a', 'future/model-c']);
    expect(filterCapabilitiesForProvider(caps, 'daydream')).toEqual(caps);
  });

  it('resolves plan capabilities with provider-aware filtering', () => {
    seedPymthouseManifestForTests({
      capabilities: [{ pipeline: 'video', modelId: 'model-a' }],
      excludedCapabilities: [{ pipeline: 'video', modelId: 'model-z' }],
    });

    expect(resolvePlanCapabilitiesForProvider({
      billingProviderSlug: 'pymthouse',
      capabilities: ['video/model-a', 'video/model-z', 'future/model-c'],
    } as const)).toEqual(['video/model-a', 'future/model-c']);
  });

  it('checks capability allow decision via provider semantics', () => {
    seedPymthouseManifestForTests({
      capabilities: [{ pipeline: 'video', modelId: 'model-a' }],
      excludedCapabilities: [{ pipeline: 'video', modelId: 'model-b' }],
    });

    expect(isCapabilityAllowedForProvider('video/model-a', 'pymthouse')).toBe(true);
    expect(isCapabilityAllowedForProvider('video/model-b', 'pymthouse')).toBe(false);
    expect(isCapabilityAllowedForProvider('future/model-c', 'pymthouse')).toBe(true);
    expect(isCapabilityAllowedForProvider('video/model-b', 'daydream')).toBe(true);
  });
});
