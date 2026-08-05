import { describe, it, expect } from 'vitest';
import { mergeSignerBundleForTest } from '../signer-bundle-config';
import { SIGNER_BUNDLE_DEFAULTS } from '../signer-bundle-defaults';
import {
  isSignerBundleDiscoveryEnabled,
  isSignerBundleSlug,
  SIGNER_BUNDLE_DISCOVERY_FLAG,
  SignerBundlesConfigSchema,
} from '../signer-bundle-types';

describe('signer-bundle-config helpers', () => {
  it('isSignerBundleSlug accepts only known slugs', () => {
    expect(isSignerBundleSlug('daydream-byoc')).toBe(true);
    expect(isSignerBundleSlug('pymthouse-live-runner')).toBe(true);
    expect(isSignerBundleSlug('storyboard-default')).toBe(false);
  });

  it('flag defaults OFF', () => {
    const prev = process.env[SIGNER_BUNDLE_DISCOVERY_FLAG];
    delete process.env[SIGNER_BUNDLE_DISCOVERY_FLAG];
    expect(isSignerBundleDiscoveryEnabled()).toBe(false);
    process.env[SIGNER_BUNDLE_DISCOVERY_FLAG] = 'true';
    expect(isSignerBundleDiscoveryEnabled()).toBe(true);
    process.env[SIGNER_BUNDLE_DISCOVERY_FLAG] = '1';
    expect(isSignerBundleDiscoveryEnabled()).toBe(true);
    if (prev === undefined) delete process.env[SIGNER_BUNDLE_DISCOVERY_FLAG];
    else process.env[SIGNER_BUNDLE_DISCOVERY_FLAG] = prev;
  });

  it('merge preserves defaults for omitted fields', () => {
    const merged = mergeSignerBundleForTest('daydream-byoc', {
      slug: 'daydream-byoc',
      topN: 5,
    });
    expect(merged.topN).toBe(5);
    expect(merged.categories).toEqual(SIGNER_BUNDLE_DEFAULTS['daydream-byoc'].categories);
    expect(merged.billingProviderSlug).toBe('daydream');
  });

  it('rejects invalid admin payload', () => {
    const bad = SignerBundlesConfigSchema.safeParse({
      bundles: [{ slug: 'not-a-bundle', topN: 1 }],
    });
    expect(bad.success).toBe(false);
  });

  it('accepts valid admin override payload', () => {
    const ok = SignerBundlesConfigSchema.safeParse({
      bundles: [
        {
          slug: 'pymthouse-live-runner',
          categories: ['lr'],
          categoryStaticOrchestrators: {
            lr: ['https://liverunner-staging-1.daydream.monster:8935'],
          },
          topN: 50,
        },
      ],
    });
    expect(ok.success).toBe(true);
  });
});
