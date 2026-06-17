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

const prisma = vi.hoisted(() => ({
  devApiKey: { findUnique: vi.fn(), update: vi.fn() },
  team: { findUnique: vi.fn() },
  application: { findFirst: vi.fn() },
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
  // NAAP-D app registry: default to a team-scoped app with a wildcard grant so
  // the integrated front door (app_registry ON in these tests) resolves it.
  prisma.application.findFirst.mockResolvedValue({
    id: 'storyboard',
    slug: 'storyboard',
    type: 'app',
    teamId: 'team-1',
    ownerUserId: null,
    allowedScopes: ['gateway', 'llm'],
    allowedCapabilities: ['*'],
    status: 'active',
  });
  getBillingProviderAdapter.mockReturnValue(adapterMock());
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
    // App registry resolved: scopes attached; wildcard grant passes caps through.
    expect(d.app).toEqual({ id: 'storyboard', scopes: ['gateway', 'llm'] });
    expect(d.billingAccount).toEqual({ id: 'acct_om_1', providerSlug: 'pymthouse' });
    expect(d.capabilities).toEqual(['text-to-image:sdxl']);
    expect(d.quota).toEqual({ remaining: 9 });
    expect(d.signerSession.accessToken).toBe('signer-tok');
  });

  it('registry-checks the app: 403 for an unregistered X-App-Id (NAAP-C↔NAAP-D)', async () => {
    prisma.application.findFirst.mockResolvedValue(null);
    const res = await POST(req(rawKey, { 'x-app-id': 'ghost-app' }));
    expect(res.status).toBe(403);
  });

  it('403 when the app is owned by a different team scope', async () => {
    prisma.application.findFirst.mockResolvedValue({
      id: 'other', slug: 'other', type: 'app', teamId: 'team-OTHER', ownerUserId: null,
      allowedScopes: ['gateway'], allowedCapabilities: ['*'], status: 'active',
    });
    const res = await POST(req(rawKey, { 'x-app-id': 'other' }));
    expect(res.status).toBe(403);
  });

  it('gates capabilities to the app grant (intersection with provider caps)', async () => {
    prisma.application.findFirst.mockResolvedValue({
      id: 'app2', slug: 'app2', type: 'cli', teamId: 'team-1', ownerUserId: null,
      allowedScopes: ['gateway'], allowedCapabilities: ['tool:byoc-demo'], status: 'active',
    });
    getBillingProviderAdapter.mockReturnValue(
      adapterMock({
        validate: vi.fn(async () => ({
          valid: true,
          capabilities: ['text-to-image:sdxl', 'tool:byoc-demo'],
          quota: null,
        })),
      }),
    );
    const res = await POST(req(rawKey, { 'x-app-id': 'app2' }));
    expect(res.status).toBe(200);
    const json = await res.json();
    // sdxl filtered out (not granted to app2); byoc-demo kept.
    expect(json.data.capabilities).toEqual(['tool:byoc-demo']);
    expect(json.data.app).toEqual({ id: 'app2', scopes: ['gateway'] });
  });

  it('app_registry OFF → attribution only, no registry check (zero regression)', async () => {
    isFeatureEnabled.mockImplementation(async (flag: string) => flag !== 'app_registry');
    prisma.application.findFirst.mockResolvedValue(null);
    const res = await POST(req(rawKey, { 'x-app-id': 'unregistered-but-ok' }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.app).toEqual({ id: 'unregistered-but-ok' });
    expect(prisma.application.findFirst).not.toHaveBeenCalled();
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
