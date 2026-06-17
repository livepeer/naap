/** @vitest-environment node */

/**
 * STUB-deploy guardrail tests.
 *
 * Proves the C0 stub is a *registered, resolvable* billing provider that sits
 * alongside pymthouse — the Phase-0 "registry resolves ≥2 providers" bar and the
 * substrate for INT-G (a naap_ key resolving against BOTH providers).
 */

import { describe, it, expect, vi } from 'vitest';

import { BILLING_PROVIDERS } from '@naap/database';
import {
  STUB_PROVIDER_SLUG,
  findStubSeed,
  isStubSeedRegistered,
  isStubAdapterResolvable,
  isStubProviderDeployEnabled,
  logStubDeployStatus,
} from './stub-provider-config';
import {
  getBillingProviderAdapter,
  listBillingProviderSlugs,
} from './registry';
import {
  resolveBillingProviderAdapter,
  resetAdapterFactoriesForTests,
} from './registry-db';

describe('stub catalog registration', () => {
  it('registers the stub as a BillingProvider with a stub-resolving adapterType', () => {
    const seed = findStubSeed(BILLING_PROVIDERS);
    expect(seed).toBeDefined();
    expect(seed?.slug).toBe('stub');
    expect(seed?.adapterType).toBe('stub');
    expect(isStubSeedRegistered(BILLING_PROVIDERS)).toBe(true);
  });

  it('keeps the stub catalog-disabled so it stays out of the prod provider picker', () => {
    expect(findStubSeed(BILLING_PROVIDERS)?.enabled).toBe(false);
  });

  it('still registers pymthouse alongside it (≥2 providers)', () => {
    const slugs = BILLING_PROVIDERS.map((p) => p.slug);
    expect(slugs).toContain('pymthouse');
    expect(slugs).toContain('stub');
  });
});

describe('stub adapter resolution (static registry)', () => {
  it('resolves the stub adapter from the registry', () => {
    expect(isStubAdapterResolvable()).toBe(true);
    expect(getBillingProviderAdapter(STUB_PROVIDER_SLUG)?.slug).toBe('stub');
  });

  it('registry resolves BOTH pymthouse and stub (provider-agnostic seam)', () => {
    const slugs = listBillingProviderSlugs();
    expect(slugs).toContain('pymthouse');
    expect(slugs).toContain('stub');
  });
});

describe('stub adapter resolution (DB registry, NAAP-A-db)', () => {
  it('resolves slug "stub" → StubAdapter when the DB registry flag is ON', async () => {
    resetAdapterFactoriesForTests();
    vi.doMock('@/lib/feature-flags', () => ({
      isFeatureEnabled: vi.fn(async () => true),
    }));
    // resolveBillingProviderAdapter falls back to the static map when the DB row
    // is absent (adapterType ?? slug = "stub"), so the stub stays resolvable
    // even before the catalog row is seeded — zero-regression by construction.
    const adapter = await resolveBillingProviderAdapter('stub');
    expect(adapter?.slug).toBe('stub');
    vi.doUnmock('@/lib/feature-flags');
  });
});

describe('deploy gate + structured logging', () => {
  it('defaults the deploy env gate OFF', () => {
    const prev = process.env.NAAP_ENABLE_STUB_PROVIDER;
    delete process.env.NAAP_ENABLE_STUB_PROVIDER;
    expect(isStubProviderDeployEnabled()).toBe(false);
    if (prev !== undefined) process.env.NAAP_ENABLE_STUB_PROVIDER = prev;
  });

  it('logs a structured status line without secrets', () => {
    const lines: string[] = [];
    const status = logStubDeployStatus(BILLING_PROVIDERS, {
      info: (m) => lines.push(m),
      warn: (m) => lines.push(m),
    });
    expect(status.adapterResolvable).toBe(true);
    expect(status.seedRegistered).toBe(true);
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]);
    expect(parsed.event).toBe('billing.provider.stub.deploy_status');
    expect(parsed.level).toBe('info');
    // No secret-bearing keys.
    expect(JSON.stringify(parsed)).not.toMatch(/secret|token|password/i);
  });
});
