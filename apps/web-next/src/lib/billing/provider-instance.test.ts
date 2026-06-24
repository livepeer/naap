/** @vitest-environment node */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({
  prisma: {
    secretVault: { findUnique: vi.fn() },
  },
}));

const decryptV1 = vi.fn();
vi.mock('@naap/crypto', () => ({
  decryptV1: (...a: unknown[]) => decryptV1(...a),
}));

const createPmtHouseClient = vi.fn();
vi.mock('@/lib/pymthouse-client', () => ({
  createPmtHouseClient: (...a: unknown[]) => createPmtHouseClient(...a),
  getPmtHouseServerClient: vi.fn(),
}));

vi.mock('@pymthouse/builder-sdk/config', () => ({
  isPymthouseConfigured: () => true,
}));

import { prisma } from '@/lib/db';
import {
  buildAdapterForProviderInstance,
  getProviderInstanceSecret,
  parsePymthouseInstanceConfig,
  type ProviderInstanceRecord,
} from './provider-instance';

const secretFindUnique = prisma.secretVault.findUnique as ReturnType<typeof vi.fn>;

const GOOD_CONFIG = {
  issuerUrl: 'https://acme.pymthouse.com',
  publicClientId: 'app_acme',
  m2mClientId: 'm2m_acme',
};

function instance(overrides: Partial<ProviderInstanceRecord> = {}): ProviderInstanceRecord {
  return {
    id: 'pi_acme',
    adapterType: 'pymthouse',
    slug: 'pymthouse-acme',
    config: { ...GOOD_CONFIG },
    secretRef: 'pmt:acme:m2m-secret',
    enabled: true,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('parsePymthouseInstanceConfig', () => {
  it('parses + trims the non-secret connection params', () => {
    const cfg = parsePymthouseInstanceConfig({
      issuerUrl: '  https://acme.pymthouse.com  ',
      publicClientId: ' app_acme ',
      m2mClientId: ' m2m_acme ',
    });
    expect(cfg).toEqual({
      issuerUrl: 'https://acme.pymthouse.com',
      publicClientId: 'app_acme',
      m2mClientId: 'm2m_acme',
    });
  });

  it('passes through allowInsecureHttp only when it is a boolean', () => {
    expect(parsePymthouseInstanceConfig({ ...GOOD_CONFIG, allowInsecureHttp: true })?.allowInsecureHttp).toBe(true);
    expect('allowInsecureHttp' in (parsePymthouseInstanceConfig({ ...GOOD_CONFIG, allowInsecureHttp: 'yes' }) ?? {})).toBe(false);
  });

  it('returns null when a required field is missing or blank', () => {
    expect(parsePymthouseInstanceConfig({ publicClientId: 'x', m2mClientId: 'y' })).toBeNull();
    expect(parsePymthouseInstanceConfig({ ...GOOD_CONFIG, issuerUrl: '   ' })).toBeNull();
  });

  it('returns null for non-object config', () => {
    expect(parsePymthouseInstanceConfig(null)).toBeNull();
    expect(parsePymthouseInstanceConfig('str')).toBeNull();
    expect(parsePymthouseInstanceConfig(['a'])).toBeNull();
  });

  it('INV-secret-isolation: never surfaces a secret value even if present in config', () => {
    const cfg = parsePymthouseInstanceConfig({
      ...GOOD_CONFIG,
      m2mClientSecret: 'leaked-secret',
    });
    expect(cfg).not.toBeNull();
    expect(Object.keys(cfg ?? {})).not.toContain('m2mClientSecret');
    expect(JSON.stringify(cfg)).not.toContain('leaked-secret');
  });
});

describe('getProviderInstanceSecret', () => {
  it('resolves + decrypts the vault value', async () => {
    secretFindUnique.mockResolvedValue({ encryptedValue: 'v1:gcm:scrypt:...' });
    decryptV1.mockReturnValue('super-secret');
    await expect(getProviderInstanceSecret('pmt:acme:m2m-secret')).resolves.toBe('super-secret');
    expect(secretFindUnique).toHaveBeenCalledWith({
      where: { key: 'pmt:acme:m2m-secret' },
      select: { encryptedValue: true },
    });
  });

  it('returns null for a blank ref without touching the DB', async () => {
    await expect(getProviderInstanceSecret('   ')).resolves.toBeNull();
    expect(secretFindUnique).not.toHaveBeenCalled();
  });

  it('returns null when the vault row is missing', async () => {
    secretFindUnique.mockResolvedValue(null);
    await expect(getProviderInstanceSecret('missing')).resolves.toBeNull();
  });

  it('returns null (never throws) when decryption fails', async () => {
    secretFindUnique.mockResolvedValue({ encryptedValue: 'corrupt' });
    decryptV1.mockImplementation(() => {
      throw new Error('bad envelope');
    });
    await expect(getProviderInstanceSecret('pmt:acme:m2m-secret')).resolves.toBeNull();
  });
});

describe('buildAdapterForProviderInstance', () => {
  it('builds a pymthouse adapter bound to a per-instance client', async () => {
    secretFindUnique.mockResolvedValue({ encryptedValue: 'v1' });
    decryptV1.mockReturnValue('super-secret');
    const fakeClient = { id: 'client-acme' };
    createPmtHouseClient.mockReturnValue(fakeClient);

    const adapter = await buildAdapterForProviderInstance(instance());
    expect(adapter?.slug).toBe('pymthouse');
    expect(adapter?.isConfigured()).toBe(true);
    expect(createPmtHouseClient).toHaveBeenCalledWith({
      issuerUrl: GOOD_CONFIG.issuerUrl,
      publicClientId: GOOD_CONFIG.publicClientId,
      m2mClientId: GOOD_CONFIG.m2mClientId,
      m2mClientSecret: 'super-secret',
    });
  });

  it('returns undefined for incomplete config (no client built)', async () => {
    const adapter = await buildAdapterForProviderInstance(instance({ config: { issuerUrl: 'x' } }));
    expect(adapter).toBeUndefined();
    expect(createPmtHouseClient).not.toHaveBeenCalled();
  });

  it('returns undefined when no secretRef is set', async () => {
    const adapter = await buildAdapterForProviderInstance(instance({ secretRef: null }));
    expect(adapter).toBeUndefined();
    expect(createPmtHouseClient).not.toHaveBeenCalled();
  });

  it('returns undefined when the secret cannot be resolved', async () => {
    secretFindUnique.mockResolvedValue(null);
    const adapter = await buildAdapterForProviderInstance(instance());
    expect(adapter).toBeUndefined();
    expect(createPmtHouseClient).not.toHaveBeenCalled();
  });

  it('returns undefined for a non-pymthouse adapterType (config-free in P0)', async () => {
    const adapter = await buildAdapterForProviderInstance(instance({ adapterType: 'stub' }));
    expect(adapter).toBeUndefined();
  });
});
