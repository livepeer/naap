/** @vitest-environment node */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

import { POST } from './route';
import { AdapterNotImplementedError } from '@/lib/billing/adapter';
import { generateNativeApiKey } from '@/lib/dev-api/native-key';
import { hashApiKey } from '@naap/database';

const isFeatureEnabled = vi.fn();
vi.mock('@/lib/feature-flags', () => ({ isFeatureEnabled: (...a: unknown[]) => isFeatureEnabled(...a) }));

vi.mock('@/lib/api/rate-limit', () => ({ enforceRateLimit: vi.fn(() => null) }));

const getBillingProviderAdapter = vi.fn();
vi.mock('@/lib/billing/registry', () => ({
  getBillingProviderAdapter: (...a: unknown[]) => getBillingProviderAdapter(...a),
}));

const resolveKeyProviderBinding = vi.fn();
vi.mock('@/lib/billing/key-provider-binding', () => ({
  resolveKeyProviderBinding: (...a: unknown[]) => resolveKeyProviderBinding(...a),
}));

const prisma = vi.hoisted(() => ({
  devApiKey: { findUnique: vi.fn(), update: vi.fn() },
  team: { findUnique: vi.fn() },
}));
vi.mock('@/lib/db', () => ({ prisma }));

// A real native key + its stored hash so verifyNativeKeyHash passes.
const { rawKey } = generateNativeApiKey();
const keyHash = hashApiKey(rawKey);

function adapterMock(overrides: Record<string, unknown> = {}) {
  return {
    slug: 'pymthouse',
    isConfigured: vi.fn(() => true),
    mintSignerSession: vi.fn(async () => ({ accessToken: 'signer-tok', tokenType: 'Bearer', expiresIn: 3600 })),
    validate: vi.fn(async () => ({ valid: true, capabilities: ['text-to-image:sdxl'], quota: { remaining: 9 } })),
    ...overrides,
  };
}

function req(token: string | null, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest('http://localhost/api/v1/keys/validate', {
    method: 'POST',
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  isFeatureEnabled.mockResolvedValue(true);
  prisma.devApiKey.findUnique.mockResolvedValue({
    id: 'key-1',
    userId: 'user-1',
    keyHash,
    status: 'ACTIVE',
    seatId: 'seat-1',
    teamId: 'team-1',
  });
  prisma.team.findUnique.mockResolvedValue({
    id: 'team-1',
    billingAccountProviderSlug: 'pymthouse',
    billingAccountId: 'acct_om_1',
  });
  prisma.devApiKey.update.mockResolvedValue({});
  getBillingProviderAdapter.mockReturnValue(adapterMock());
  // Default: legacy binding → today's exact path (existing tests unchanged).
  resolveKeyProviderBinding.mockResolvedValue({ mode: 'legacy', reason: 'flag_off' });
});

describe('flag OFF (zero regression / fallback)', () => {
  it('404 no-op when OFF; never touches DB', async () => {
    isFeatureEnabled.mockResolvedValue(false);
    const res = await POST(req(rawKey));
    expect(res.status).toBe(404);
    expect(prisma.devApiKey.findUnique).not.toHaveBeenCalled();
  });
});

describe('auth + D1 enforcement', () => {
  it('401 when no bearer', async () => {
    expect((await POST(req(null))).status).toBe(401);
  });
  it('401 for a provider token (passthrough disabled, D1)', async () => {
    const res = await POST(req('pmth_sometoken'));
    expect(res.status).toBe(401);
    expect(prisma.devApiKey.findUnique).not.toHaveBeenCalled();
  });
  it('401 for a malformed naap_ key', async () => {
    const res = await POST(req('naap_short'));
    expect(res.status).toBe(401);
  });
  it('401 for an unknown key (no enumeration)', async () => {
    prisma.devApiKey.findUnique.mockResolvedValue(null);
    expect((await POST(req(rawKey))).status).toBe(401);
  });
  it('401 on hash mismatch', async () => {
    prisma.devApiKey.findUnique.mockResolvedValue({
      id: 'key-1', userId: 'user-1', keyHash: 'deadbeef', status: 'ACTIVE', seatId: 'seat-1', teamId: 'team-1',
    });
    expect((await POST(req(rawKey))).status).toBe(401);
  });
  it('401 for a revoked key', async () => {
    prisma.devApiKey.findUnique.mockResolvedValue({
      id: 'key-1', userId: 'user-1', keyHash, status: 'REVOKED', seatId: 'seat-1', teamId: 'team-1',
    });
    expect((await POST(req(rawKey))).status).toBe(401);
  });
});

describe('resolution (provider-agnostic, BPP ③)', () => {
  it('200 with the full contract shape (pymthouse)', async () => {
    const res = await POST(req(rawKey, { 'x-app-id': 'storyboard' }));
    expect(res.status).toBe(200);
    const json = await res.json();
    const d = json.data;
    expect(d.valid).toBe(true);
    expect(d.user).toEqual({ sub: 'user-1' });
    expect(d.app).toEqual({ id: 'storyboard' });
    expect(d.billingAccount).toEqual({ id: 'acct_om_1', providerSlug: 'pymthouse' });
    expect(d.capabilities).toEqual(['text-to-image:sdxl']);
    expect(d.quota).toEqual({ remaining: 9 });
    expect(d.signerSession.accessToken).toBe('signer-tok');
  });

  it('resolves the SAME key against the C0 stub provider', async () => {
    prisma.team.findUnique.mockResolvedValue({
      id: 'team-1', billingAccountProviderSlug: 'stub', billingAccountId: 'acct_stub_1',
    });
    getBillingProviderAdapter.mockReturnValue(adapterMock({ slug: 'stub' }));
    const res = await POST(req(rawKey));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.billingAccount.providerSlug).toBe('stub');
  });

  it('capabilities fail CLOSED ([]) when the provider has not wired validate', async () => {
    getBillingProviderAdapter.mockReturnValue(
      adapterMock({
        validate: vi.fn(async () => {
          throw new AdapterNotImplementedError('pymthouse', 'validate');
        }),
      }),
    );
    const res = await POST(req(rawKey));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.capabilities).toEqual([]);
    // still returns a usable signer session
    expect(json.data.signerSession.accessToken).toBe('signer-tok');
  });

  it('403 when the key/team is not bound to a billing account', async () => {
    prisma.team.findUnique.mockResolvedValue({
      id: 'team-1', billingAccountProviderSlug: null, billingAccountId: null,
    });
    expect((await POST(req(rawKey))).status).toBe(403);
  });

  it('503 when the bound provider is unavailable', async () => {
    getBillingProviderAdapter.mockReturnValue(adapterMock({ isConfigured: vi.fn(() => false) }));
    expect((await POST(req(rawKey))).status).toBe(503);
  });

  it('400 for a malformed X-App-Id', async () => {
    const res = await POST(req(rawKey, { 'x-app-id': 'bad id!' }));
    expect(res.status).toBe(400);
  });
});

describe('P2 per-key subscription resolution (multi_subscription)', () => {
  it('INV: legacy binding (flag OFF / null subscriptionId) is byte-for-byte today', async () => {
    // Default binding is legacy. Resolution uses team account + global adapter.
    const res = await POST(req(rawKey));
    expect(res.status).toBe(200);
    const d = (await res.json()).data;
    expect(d.billingAccount).toEqual({ id: 'acct_om_1', providerSlug: 'pymthouse' });
    // The key's subscriptionId is consulted via the binding resolver…
    expect(resolveKeyProviderBinding).toHaveBeenCalledTimes(1);
    // …and on legacy the global registry adapter IS used (today's path).
    expect(getBillingProviderAdapter).toHaveBeenCalledWith('pymthouse');
  });

  it('flag ON + linked subscription → per-instance adapter + per-account scoping', async () => {
    prisma.devApiKey.findUnique.mockResolvedValue({
      id: 'key-1', userId: 'user-1', keyHash, status: 'ACTIVE',
      seatId: 'seat-1', teamId: 'team-1', subscriptionId: 'sub-1',
    });
    // A DISTINCT per-instance adapter (different account + capabilities) so we
    // can prove resolution scoped to the subscription, not the team account.
    const instanceAdapter = adapterMock({
      slug: 'pymthouse',
      mintSignerSession: vi.fn(async () => ({ accessToken: 'instance-tok', tokenType: 'Bearer', expiresIn: 3600 })),
      validate: vi.fn(async () => ({ valid: true, capabilities: ['video:gen'], quota: { remaining: 3 } })),
    });
    resolveKeyProviderBinding.mockResolvedValue({
      mode: 'subscription',
      subscription: { id: 'sub-1', teamId: 'team-1', providerInstanceId: 'inst-1', providerPlanId: null, accountId: 'acct_sub_99', status: 'active', appId: null },
      adapter: instanceAdapter,
      billingAccountRef: { providerSlug: 'pymthouse', accountId: 'acct_sub_99' },
    });

    const res = await POST(req(rawKey));
    expect(res.status).toBe(200);
    const d = (await res.json()).data;

    // Account + capabilities + signer all come from the SUBSCRIPTION/instance.
    expect(d.billingAccount).toEqual({ id: 'acct_sub_99', providerSlug: 'pymthouse' });
    expect(d.capabilities).toEqual(['video:gen']);
    expect(d.quota).toEqual({ remaining: 3 });
    expect(d.signerSession.accessToken).toBe('instance-tok');
    // Per-account scoping: validate + mint keyed off the subscription account.
    expect(instanceAdapter.validate).toHaveBeenCalledWith('acct_sub_99');
    expect(instanceAdapter.mintSignerSession).toHaveBeenCalledWith(
      expect.objectContaining({ externalUserId: 'acct_sub_99' }),
    );
    // The global env adapter is NEVER consulted in subscription mode.
    expect(getBillingProviderAdapter).not.toHaveBeenCalled();
    // The binding resolver received the key's subscriptionId + teamId.
    expect(resolveKeyProviderBinding).toHaveBeenCalledWith({ subscriptionId: 'sub-1', teamId: 'team-1' });
  });

  it('subscription mode still fails safe (503) when the instance adapter is unconfigured', async () => {
    resolveKeyProviderBinding.mockResolvedValue({
      mode: 'subscription',
      subscription: { id: 'sub-1', teamId: 'team-1', providerInstanceId: 'inst-1', providerPlanId: null, accountId: 'acct_sub_99', status: 'active', appId: null },
      adapter: adapterMock({ isConfigured: vi.fn(() => false) }),
      billingAccountRef: { providerSlug: 'pymthouse', accountId: 'acct_sub_99' },
    });
    expect((await POST(req(rawKey))).status).toBe(503);
  });
});

describe('NAAP-E capability gate', () => {
  // Front door flag ON; capability_gate toggled per test.
  const flags = (capabilityGate: boolean) =>
    isFeatureEnabled.mockImplementation(async (key: string) =>
      key === 'key_validation_front_door' ? true : key === 'capability_gate' ? capabilityGate : false,
    );

  it('flag OFF → no enforcement: ungranted capability still passes (200)', async () => {
    flags(false);
    const res = await POST(req(rawKey, { 'x-requested-capability': 'tool:not-granted' }));
    expect(res.status).toBe(200);
    expect((await res.json()).data.capabilities).toEqual(['text-to-image:sdxl']);
  });

  it('flag ON + no requested capability → pass-through (200)', async () => {
    flags(true);
    expect((await POST(req(rawKey))).status).toBe(200);
  });

  it('flag ON + granted capability → allow (200)', async () => {
    flags(true);
    const res = await POST(req(rawKey, { 'x-requested-capability': 'text-to-image:sdxl' }));
    expect(res.status).toBe(200);
  });

  it('flag ON + ungranted capability → deny (403, fail closed)', async () => {
    flags(true);
    const res = await POST(req(rawKey, { 'x-requested-capability': 'tool:rogue' }));
    expect(res.status).toBe(403);
  });

  it('flag ON + empty grant set + requested capability → deny (403, fail closed)', async () => {
    flags(true);
    getBillingProviderAdapter.mockReturnValue(
      adapterMock({
        validate: vi.fn(async () => {
          throw new AdapterNotImplementedError('pymthouse', 'validate');
        }),
      }),
    );
    const res = await POST(req(rawKey, { 'x-requested-capability': 'text-to-image:sdxl' }));
    expect(res.status).toBe(403);
  });

  it('flag ON + wildcard grant → allow any capability (200)', async () => {
    flags(true);
    getBillingProviderAdapter.mockReturnValue(
      adapterMock({ validate: vi.fn(async () => ({ valid: true, capabilities: ['*'] })) }),
    );
    const res = await POST(req(rawKey, { 'x-requested-capability': 'tool:anything' }));
    expect(res.status).toBe(200);
  });
});
