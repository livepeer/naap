/**
 * Tests for discovery-scoped service keys (NAAP-4).
 *
 * Covers minting a `gw_` service key scoped to discovery, the scope helper, and
 * that a minted key resolves through `authorize()` (so the discovery endpoint
 * accepts it) — without changing behavior of existing unscoped keys.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHash } from 'crypto';

vi.mock('@/lib/db', () => ({
  prisma: {
    gatewayApiKey: {
      create: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn().mockResolvedValue({}),
    },
    gatewayMasterKey: { findUnique: vi.fn() },
    teamMember: { findFirst: vi.fn() },
  },
}));

vi.mock('@/lib/api/auth', () => ({ validateSession: vi.fn() }));
vi.mock('@/lib/api/response', () => ({
  getAuthToken: vi.fn(),
  getClientIP: vi.fn().mockReturnValue('127.0.0.1'),
}));
vi.mock('@naap/cache', () => ({
  createRateLimiter: () => ({
    consume: vi.fn().mockResolvedValue({ allowed: true }),
  }),
}));

import { prisma } from '@/lib/db';
import {
  DISCOVERY_ENDPOINT,
  keyAllowsDiscovery,
  mintServiceDiscoveryKey,
} from '../service-key';
import { authorize } from '../authorize';

const mockCreate = prisma.gatewayApiKey.create as ReturnType<typeof vi.fn>;
const mockFindUnique = prisma.gatewayApiKey.findUnique as ReturnType<typeof vi.fn>;

describe('keyAllowsDiscovery', () => {
  it('allows when allowlist is empty (all endpoints) — existing keys unchanged', () => {
    expect(keyAllowsDiscovery(undefined)).toBe(true);
    expect(keyAllowsDiscovery([])).toBe(true);
  });

  it('allows when discovery endpoint is in the allowlist', () => {
    expect(keyAllowsDiscovery([DISCOVERY_ENDPOINT])).toBe(true);
    expect(keyAllowsDiscovery(['/other', DISCOVERY_ENDPOINT])).toBe(true);
  });

  it('rejects when allowlist is set but excludes discovery', () => {
    expect(keyAllowsDiscovery(['/api/v1/gw/some-connector'])).toBe(false);
  });
});

describe('mintServiceDiscoveryKey', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      id: 'key-1',
      keyPrefix: data.keyPrefix,
    }));
  });

  it('mints a gw_ key scoped to discovery for a team', async () => {
    const result = await mintServiceDiscoveryKey({
      name: 'sdk-service',
      createdBy: 'user-1',
      teamId: 'team-1',
    });

    expect(result.rawKey.startsWith('gw_')).toBe(true);
    expect(result.allowedEndpoints).toEqual([DISCOVERY_ENDPOINT]);
    expect(result.keyPrefix).toBe(result.rawKey.slice(0, 11));

    const createArg = mockCreate.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(createArg.data.teamId).toBe('team-1');
    expect(createArg.data.ownerUserId).toBeUndefined();
    expect(createArg.data.allowedEndpoints).toEqual([DISCOVERY_ENDPOINT]);
    // Only the SHA-256 hash is persisted, never the raw key.
    expect(createArg.data.keyHash).toBe(
      createHash('sha256').update(result.rawKey).digest('hex'),
    );
    expect(Object.values(createArg.data)).not.toContain(result.rawKey);
  });

  it('merges additional endpoints without duplicating discovery', async () => {
    const result = await mintServiceDiscoveryKey({
      name: 'sdk-service',
      createdBy: 'user-1',
      ownerUserId: 'user-1',
      additionalEndpoints: ['/api/v1/gw/catalog', DISCOVERY_ENDPOINT],
    });
    expect(result.allowedEndpoints).toEqual([DISCOVERY_ENDPOINT, '/api/v1/gw/catalog']);
  });

  it('requires exactly one of teamId / ownerUserId', async () => {
    await expect(
      mintServiceDiscoveryKey({ name: 'x', createdBy: 'u' }),
    ).rejects.toThrow(/exactly one/);
    await expect(
      mintServiceDiscoveryKey({ name: 'x', createdBy: 'u', teamId: 't', ownerUserId: 'u' }),
    ).rejects.toThrow(/exactly one/);
  });
});

describe('authorize() accepts a minted discovery service key', () => {
  beforeEach(() => vi.clearAllMocks());

  it('resolves a gw_ service key and surfaces its discovery scope', async () => {
    const rawKey = 'gw_' + 'a'.repeat(64);
    const keyHash = createHash('sha256').update(rawKey).digest('hex');
    mockFindUnique.mockResolvedValue({
      id: 'key-1',
      teamId: 'team-1',
      ownerUserId: null,
      connectorId: null,
      status: 'active',
      expiresAt: null,
      planId: null,
      createdBy: 'user-1',
      allowedEndpoints: [DISCOVERY_ENDPOINT],
      allowedIPs: [],
      plan: null,
    });

    const request = new Request('https://naap.test' + DISCOVERY_ENDPOINT, {
      headers: { authorization: `Bearer ${rawKey}` },
    });
    const auth = await authorize(request);

    expect(auth).not.toBeNull();
    expect(auth?.callerType).toBe('apiKey');
    expect(auth?.teamId).toBe('team-1');
    expect(keyAllowsDiscovery(auth?.allowedEndpoints)).toBe(true);
    expect(mockFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { keyHash } }),
    );
  });
});
