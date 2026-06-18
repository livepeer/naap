/** @vitest-environment node */

import { describe, it, expect, afterEach } from 'vitest';

import type { BillingProviderAdapter } from './adapter';
import {
  getBillingProviderAdapter,
  hasBillingProviderAdapter,
  listBillingProviderSlugs,
  registerBillingProviderAdapter,
  resetBillingProviderRegistryForTests,
} from './registry';

afterEach(() => resetBillingProviderRegistryForTests());

describe('NAAP-A — billing provider adapter registry', () => {
  it('resolves the pymthouse + stub reference adapters (≥2 providers)', () => {
    expect(hasBillingProviderAdapter('pymthouse')).toBe(true);
    expect(hasBillingProviderAdapter('stub')).toBe(true);
    expect(getBillingProviderAdapter('pymthouse')?.slug).toBe('pymthouse');
    expect(getBillingProviderAdapter('stub')?.slug).toBe('stub');
    expect(listBillingProviderSlugs().length).toBeGreaterThanOrEqual(2);
  });

  it('returns undefined for an unknown provider', () => {
    expect(getBillingProviderAdapter('does-not-exist')).toBeUndefined();
    expect(hasBillingProviderAdapter('does-not-exist')).toBe(false);
  });

  it('accepts any object satisfying the SPI (provider-neutral)', () => {
    const fake: BillingProviderAdapter = {
      slug: 'fake',
      isConfigured: () => true,
      validate: async () => ({ valid: true }),
      getPlans: async () => [],
      getUsageForExternalUser: async () => ({}),
      getAppUsage: async () => ({}),
      mintSignerSession: async () => ({ accessToken: 'x' }),
      receiveCuratedOrchestrators: async () => {},
      getCapabilityManifest: async () => [],
    };
    registerBillingProviderAdapter(fake);
    expect(getBillingProviderAdapter('fake')).toBe(fake);
  });

  it('reset restores the default registry', () => {
    registerBillingProviderAdapter({
      slug: 'temp',
      isConfigured: () => true,
      validate: async () => ({ valid: true }),
      getPlans: async () => [],
      getUsageForExternalUser: async () => ({}),
      getAppUsage: async () => ({}),
      mintSignerSession: async () => ({ accessToken: 'x' }),
      receiveCuratedOrchestrators: async () => {},
      getCapabilityManifest: async () => [],
    });
    expect(hasBillingProviderAdapter('temp')).toBe(true);
    resetBillingProviderRegistryForTests();
    expect(hasBillingProviderAdapter('temp')).toBe(false);
    expect(hasBillingProviderAdapter('pymthouse')).toBe(true);
  });
});
