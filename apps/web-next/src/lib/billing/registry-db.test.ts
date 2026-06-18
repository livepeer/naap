/** @vitest-environment node */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/db', () => ({
  prisma: {
    billingProvider: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock('@/lib/feature-flags', () => ({
  isFeatureEnabled: vi.fn(),
}));

import { prisma } from '@/lib/db';
import { isFeatureEnabled } from '@/lib/feature-flags';
import {
  DB_ADAPTER_REGISTRY_FLAG,
  resolveBillingProviderAdapter,
  resolveBillingProviderAdapterDetailed,
  registerAdapterFactoryForTests,
  resetAdapterFactoriesForTests,
} from './registry-db';

const findUnique = prisma.billingProvider.findUnique as ReturnType<typeof vi.fn>;
const flag = isFeatureEnabled as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  resetAdapterFactoriesForTests();
});

describe('NAAP-A-db — DB-driven adapter registry', () => {
  describe('flag OFF (default) — zero regression', () => {
    beforeEach(() => flag.mockResolvedValue(false));

    it('resolves from the static registry by slug and never touches the DB', async () => {
      const res = await resolveBillingProviderAdapterDetailed('pymthouse');
      expect(res.source).toBe('static');
      expect(res.adapter?.slug).toBe('pymthouse');
      expect(findUnique).not.toHaveBeenCalled();
    });

    it('returns undefined for an unknown provider (parity with static map)', async () => {
      const res = await resolveBillingProviderAdapter('does-not-exist');
      expect(res).toBeUndefined();
      expect(findUnique).not.toHaveBeenCalled();
    });
  });

  describe('flag ON — DB-driven', () => {
    beforeEach(() => flag.mockResolvedValue(true));

    it('resolves the adapter from the row adapterType', async () => {
      findUnique.mockResolvedValue({ adapterType: 'pymthouse' });
      const res = await resolveBillingProviderAdapterDetailed('pymthouse');
      expect(res.source).toBe('db');
      expect(res.adapterType).toBe('pymthouse');
      expect(res.adapter?.slug).toBe('pymthouse');
    });

    it('maps a custom provider slug to a shared adapterType implementation', async () => {
      findUnique.mockResolvedValue({ adapterType: 'stub' });
      const res = await resolveBillingProviderAdapterDetailed('acme-billing');
      expect(res.source).toBe('db');
      expect(res.adapterType).toBe('stub');
      expect(res.adapter?.slug).toBe('stub');
    });

    it('falls back to the slug as adapterType when the column is NULL', async () => {
      findUnique.mockResolvedValue({ adapterType: null });
      const res = await resolveBillingProviderAdapterDetailed('stub');
      expect(res.source).toBe('db');
      expect(res.adapterType).toBe('stub');
      expect(res.adapter?.slug).toBe('stub');
    });

    it('falls back to the static map when no provider row exists', async () => {
      findUnique.mockResolvedValue(null);
      const res = await resolveBillingProviderAdapterDetailed('pymthouse');
      // adapterType defaults to slug, which IS a known factory → still db source.
      expect(res.adapter?.slug).toBe('pymthouse');
    });

    it('falls back to the static map for an unknown adapterType', async () => {
      findUnique.mockResolvedValue({ adapterType: 'mystery-not-built' });
      const res = await resolveBillingProviderAdapterDetailed('mystery-not-built');
      expect(res.source).toBe('db-fallback-static');
      // No static adapter for this slug either → undefined (graceful).
      expect(res.adapter).toBeUndefined();
    });

    it('falls back to the static map (never hard-fails) when the DB query throws', async () => {
      findUnique.mockRejectedValue(new Error('connection refused'));
      const res = await resolveBillingProviderAdapterDetailed('pymthouse');
      expect(res.source).toBe('db-fallback-static');
      expect(res.adapter?.slug).toBe('pymthouse');
    });

    it('supports registering a new adapterType factory without a code change to the registry', async () => {
      registerAdapterFactoryForTests('custom', () => ({
        slug: 'custom',
        isConfigured: () => true,
        validate: async () => ({ valid: true }),
        getPlans: async () => [],
        getUsageForExternalUser: async () => ({}),
        getAppUsage: async () => ({}),
        mintSignerSession: async () => ({ accessToken: 'x' }),
        receiveCuratedOrchestrators: async () => {},
        getCapabilityManifest: async () => [],
      }));
      findUnique.mockResolvedValue({ adapterType: 'custom' });
      const res = await resolveBillingProviderAdapterDetailed('any-provider');
      expect(res.source).toBe('db');
      expect(res.adapter?.slug).toBe('custom');
    });
  });

  it('exposes the flag key', () => {
    expect(DB_ADAPTER_REGISTRY_FLAG).toBe('db_adapter_registry');
  });
});
