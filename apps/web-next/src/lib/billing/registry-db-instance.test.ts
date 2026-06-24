/** @vitest-environment node */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({
  prisma: {
    billingProvider: { findUnique: vi.fn() },
    providerInstance: { findUnique: vi.fn() },
    secretVault: { findUnique: vi.fn() },
  },
}));

const isFeatureEnabled = vi.fn();
vi.mock('@/lib/feature-flags', () => ({
  isFeatureEnabled: (...a: unknown[]) => isFeatureEnabled(...a),
  PROVIDER_INSTANCES_FLAG: 'provider_instances',
  PYMTHOUSE_BPP_VALIDATE_FLAG: 'pymthouse_bpp_validate',
}));

const createPmtHouseClient = vi.fn();
const getPmtHouseServerClient = vi.fn();
vi.mock('@/lib/pymthouse-client', () => ({
  createPmtHouseClient: (...a: unknown[]) => createPmtHouseClient(...a),
  getPmtHouseServerClient: (...a: unknown[]) => getPmtHouseServerClient(...a),
}));

const decryptV1 = vi.fn();
vi.mock('@naap/crypto', () => ({
  decryptV1: (...a: unknown[]) => decryptV1(...a),
}));

vi.mock('@pymthouse/builder-sdk/config', () => ({
  isPymthouseConfigured: () => true,
}));

import { prisma } from '@/lib/db';
import {
  PROVIDER_INSTANCES_FLAG,
  resolveAdapterForProviderInstance,
  resetAdapterFactoriesForTests,
  resetProviderInstanceAdapterCacheForTests,
} from './registry-db';

const providerInstanceFindUnique = prisma.providerInstance.findUnique as ReturnType<typeof vi.fn>;
const secretFindUnique = prisma.secretVault.findUnique as ReturnType<typeof vi.fn>;

const CONFIG_ACME = {
  issuerUrl: 'https://acme.pymthouse.com',
  publicClientId: 'app_acme',
  m2mClientId: 'm2m_acme',
};

const WINDOW = { startDate: '2026-01-01T00:00:00.000Z', endDate: '2026-01-31T23:59:59.999Z' };

beforeEach(() => {
  vi.clearAllMocks();
  resetAdapterFactoriesForTests();
  resetProviderInstanceAdapterCacheForTests();
});

afterEach(() => {
  resetAdapterFactoriesForTests();
  resetProviderInstanceAdapterCacheForTests();
});

describe('resolveAdapterForProviderInstance — flag exposure', () => {
  it('exposes the canonical flag key', () => {
    expect(PROVIDER_INSTANCES_FLAG).toBe('provider_instances');
  });
});

describe('INV-availability: provider_instances OFF → global-env single-app path unchanged', () => {
  beforeEach(() => isFeatureEnabled.mockResolvedValue(false));

  it('returns the default env-backed pymthouse adapter and reads NEITHER ProviderInstance NOR SecretVault', async () => {
    const res = await resolveAdapterForProviderInstance('pymthouse-acme');

    expect(res.source).toBe('flag-off-default-env');
    expect(res.providerInstanceId).toBeNull();
    expect(res.adapter?.slug).toBe('pymthouse');
    expect(providerInstanceFindUnique).not.toHaveBeenCalled();
    expect(secretFindUnique).not.toHaveBeenCalled();
    expect(createPmtHouseClient).not.toHaveBeenCalled();
  });

  it('the flag-OFF adapter talks to the global-env client singleton (today\'s behavior)', async () => {
    const envClient = { getUsage: vi.fn().mockResolvedValue({ byUser: [] }) };
    getPmtHouseServerClient.mockReturnValue(envClient);

    const res = await resolveAdapterForProviderInstance('pymthouse-acme');
    await res.adapter!.getAppUsage(WINDOW);

    expect(getPmtHouseServerClient).toHaveBeenCalled();
    expect(envClient.getUsage).toHaveBeenCalled();
    expect(createPmtHouseClient).not.toHaveBeenCalled();
  });
});

describe('flag ON → per-ProviderInstance adapter construction', () => {
  beforeEach(() => isFeatureEnabled.mockResolvedValue(true));

  it('builds a per-config adapter from the instance config + vault secret', async () => {
    providerInstanceFindUnique.mockResolvedValue({
      id: 'pi_acme',
      adapterType: 'pymthouse',
      slug: 'pymthouse-acme',
      config: { ...CONFIG_ACME },
      secretRef: 'pmt:acme:m2m',
      enabled: true,
    });
    secretFindUnique.mockResolvedValue({ encryptedValue: 'v1' });
    decryptV1.mockReturnValue('acme-secret');
    const acmeClient = { getUsage: vi.fn().mockResolvedValue({ byUser: [] }) };
    createPmtHouseClient.mockReturnValue(acmeClient);

    const res = await resolveAdapterForProviderInstance('pymthouse-acme');

    expect(res.source).toBe('instance');
    expect(res.providerInstanceId).toBe('pi_acme');
    expect(res.adapterType).toBe('pymthouse');
    expect(createPmtHouseClient).toHaveBeenCalledWith({ ...CONFIG_ACME, m2mClientSecret: 'acme-secret' });

    // The adapter uses the INSTANCE client, not the global-env singleton.
    await res.adapter!.getAppUsage(WINDOW);
    expect(acmeClient.getUsage).toHaveBeenCalled();
    expect(getPmtHouseServerClient).not.toHaveBeenCalled();
  });

  it('caches the adapter by ProviderInstance id (one client build per instance)', async () => {
    providerInstanceFindUnique.mockResolvedValue({
      id: 'pi_acme',
      adapterType: 'pymthouse',
      slug: 'pymthouse-acme',
      config: { ...CONFIG_ACME },
      secretRef: 'pmt:acme:m2m',
      enabled: true,
    });
    secretFindUnique.mockResolvedValue({ encryptedValue: 'v1' });
    decryptV1.mockReturnValue('acme-secret');
    createPmtHouseClient.mockReturnValue({ getUsage: vi.fn() });

    const first = await resolveAdapterForProviderInstance('pymthouse-acme');
    const second = await resolveAdapterForProviderInstance('pymthouse-acme');

    expect(first.adapter).toBe(second.adapter);
    expect(createPmtHouseClient).toHaveBeenCalledTimes(1);
  });

  it('multiple pymthouse instances coexist as distinct adapters/clients', async () => {
    const clientA = { tag: 'A' };
    const clientB = { tag: 'B' };
    createPmtHouseClient.mockReturnValueOnce(clientA).mockReturnValueOnce(clientB);
    secretFindUnique.mockResolvedValue({ encryptedValue: 'v1' });
    decryptV1.mockReturnValue('secret');

    providerInstanceFindUnique.mockResolvedValueOnce({
      id: 'pi_a',
      adapterType: 'pymthouse',
      slug: 'pymthouse-a',
      config: { ...CONFIG_ACME, publicClientId: 'app_a' },
      secretRef: 'pmt:a',
      enabled: true,
    });
    providerInstanceFindUnique.mockResolvedValueOnce({
      id: 'pi_b',
      adapterType: 'pymthouse',
      slug: 'pymthouse-b',
      config: { ...CONFIG_ACME, publicClientId: 'app_b' },
      secretRef: 'pmt:b',
      enabled: true,
    });

    const a = await resolveAdapterForProviderInstance('pymthouse-a');
    const b = await resolveAdapterForProviderInstance('pymthouse-b');

    expect(a.providerInstanceId).toBe('pi_a');
    expect(b.providerInstanceId).toBe('pi_b');
    expect(a.adapter).not.toBe(b.adapter);
    expect(createPmtHouseClient).toHaveBeenCalledTimes(2);
  });

  it('falls back to the default env adapter when the instance row is missing', async () => {
    providerInstanceFindUnique.mockResolvedValue(null);
    const res = await resolveAdapterForProviderInstance('does-not-exist');
    expect(res.source).toBe('instance-missing-default-env');
    expect(res.adapter?.slug).toBe('pymthouse');
    expect(createPmtHouseClient).not.toHaveBeenCalled();
  });

  it('falls back to the default env adapter when the instance is disabled', async () => {
    providerInstanceFindUnique.mockResolvedValue({
      id: 'pi_off',
      adapterType: 'pymthouse',
      slug: 'pymthouse-off',
      config: { ...CONFIG_ACME },
      secretRef: 'pmt:off',
      enabled: false,
    });
    const res = await resolveAdapterForProviderInstance('pymthouse-off');
    expect(res.source).toBe('instance-missing-default-env');
    expect(res.adapter?.slug).toBe('pymthouse');
  });

  it('falls back to the default env adapter when the secret cannot be resolved', async () => {
    providerInstanceFindUnique.mockResolvedValue({
      id: 'pi_acme',
      adapterType: 'pymthouse',
      slug: 'pymthouse-acme',
      config: { ...CONFIG_ACME },
      secretRef: 'pmt:acme:m2m',
      enabled: true,
    });
    secretFindUnique.mockResolvedValue(null);
    const res = await resolveAdapterForProviderInstance('pymthouse-acme');
    expect(res.source).toBe('instance-error-default-env');
    expect(res.adapter?.slug).toBe('pymthouse');
    expect(createPmtHouseClient).not.toHaveBeenCalled();
  });

  it('never hard-fails when the DB lookup throws (keeps global-env behavior)', async () => {
    providerInstanceFindUnique.mockRejectedValue(new Error('connection refused'));
    const res = await resolveAdapterForProviderInstance('pymthouse-acme');
    expect(res.source).toBe('instance-error-default-env');
    expect(res.adapter?.slug).toBe('pymthouse');
  });
});
