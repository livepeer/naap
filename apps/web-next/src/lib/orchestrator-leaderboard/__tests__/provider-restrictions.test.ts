import { afterEach, describe, expect, it } from 'vitest';
import {
  filterCapabilitiesForProvider,
  isCapabilityAllowedForProvider,
  normalizeBillingProviderSlug,
  providerRestrictionRevision,
  resolvePlanCapabilitiesForProvider,
} from '../provider-restrictions';

describe('provider-restrictions', () => {
  afterEach(() => {
    // Daydream-only: no manifest snapshot state to reset.
  });

  it('normalizes supported slugs and rejects unknown values', () => {
    expect(normalizeBillingProviderSlug(' PYMTHOUSE ')).toBeNull();
    expect(normalizeBillingProviderSlug('daydream')).toBe('daydream');
    expect(normalizeBillingProviderSlug('stripe')).toBeNull();
    expect(normalizeBillingProviderSlug(null)).toBeNull();
  });

  it('uses a stable restriction revision for caching', () => {
    expect(providerRestrictionRevision('daydream')).toBe('na');
    expect(providerRestrictionRevision('pymthouse')).toBe('na');
  });

  it('does not filter capabilities for Daydream', () => {
    const caps = ['video/model-a', 'video/model-b', 'future/model-c'];
    expect(filterCapabilitiesForProvider(caps, 'daydream')).toEqual(caps);
    expect(filterCapabilitiesForProvider(caps, 'daydream')).toEqual(caps);
  });

  it('resolves plan capabilities without manifest filtering', () => {
    expect(resolvePlanCapabilitiesForProvider({
      billingProviderSlug: 'daydream',
      capabilities: ['video/model-a', 'video/model-z', 'future/model-c'],
    } as const)).toEqual(['video/model-a', 'video/model-z', 'future/model-c']);
  });

  it('does not filter capabilities when billingProviderSlug is null', () => {
    const caps = ['video/model-a', 'video/model-b'];
    expect(filterCapabilitiesForProvider(caps, null)).toEqual(caps);
    expect(filterCapabilitiesForProvider(caps, 'pymthouse')).toEqual(caps);
  });

  it('allows capabilities under Daydream semantics', () => {
    expect(isCapabilityAllowedForProvider('video/model-a', 'daydream')).toBe(true);
    expect(isCapabilityAllowedForProvider('video/model-b', 'daydream')).toBe(true);
    // Unknown/invalid providers do not deny capabilities in PR #337.
    expect(isCapabilityAllowedForProvider('video/model-b', 'pymthouse')).toBe(true);
  });
});
