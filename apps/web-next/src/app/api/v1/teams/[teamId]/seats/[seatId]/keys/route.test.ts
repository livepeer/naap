/** @vitest-environment node */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

import { GET, POST } from './route';

const isFeatureEnabled = vi.fn();
vi.mock('@/lib/feature-flags', () => ({ isFeatureEnabled: (...a: unknown[]) => isFeatureEnabled(...a) }));

const validateSession = vi.fn();
vi.mock('@/lib/api/auth', () => ({ validateSession: (...a: unknown[]) => validateSession(...a) }));

const validateTeamAccess = vi.fn();
vi.mock('@/lib/api/teams', () => ({ validateTeamAccess: (...a: unknown[]) => validateTeamAccess(...a) }));

vi.mock('@/lib/api/csrf', () => ({ validateCSRF: vi.fn(() => null) }));

const getBillingProviderAdapter = vi.fn();
vi.mock('@/lib/billing/registry', () => ({
  getBillingProviderAdapter: (...a: unknown[]) => getBillingProviderAdapter(...a),
}));

const prisma = vi.hoisted(() => ({
  seat: { findFirst: vi.fn() },
  devApiKey: { findMany: vi.fn(), count: vi.fn(), create: vi.fn() },
  team: { findUnique: vi.fn() },
  billingProvider: { findUnique: vi.fn() },
}));
vi.mock('@/lib/db', () => ({ prisma }));

function req(url: string, init?: { method?: string; body?: unknown; headers?: Record<string, string> }): NextRequest {
  return new NextRequest(url, {
    method: init?.method,
    headers: { cookie: 'naap_auth_token=tok', 'content-type': 'application/json', ...(init?.headers ?? {}) },
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
}

const params = (teamId: string, seatId: string) => ({ params: Promise.resolve({ teamId, seatId }) });

beforeEach(() => {
  vi.clearAllMocks();
  isFeatureEnabled.mockResolvedValue(true);
  validateSession.mockResolvedValue({ id: 'user-1', email: 'u@e.co', roles: [] });
  validateTeamAccess.mockResolvedValue({ team: { id: 'team-1' }, member: { role: 'admin' } });
  prisma.seat.findFirst.mockResolvedValue({ id: 'seat-1', userId: 'user-1', status: 'active', keyLimit: 5 });
  prisma.devApiKey.findMany.mockResolvedValue([]);
  prisma.devApiKey.count.mockResolvedValue(0);
  prisma.devApiKey.create.mockImplementation(async ({ select: _s, data }: { select: unknown; data: Record<string, unknown> }) => ({
    id: 'key-1',
    keyPrefix: data.keyPrefix,
    label: data.label ?? null,
    status: data.status,
    seatId: data.seatId,
    teamId: data.teamId,
    createdAt: new Date(),
    lastUsedAt: null,
    revokedAt: null,
  }));
  prisma.team.findUnique.mockResolvedValue({
    id: 'team-1',
    billingAccountProviderSlug: 'pymthouse',
    billingAccountId: 'acct_om_1',
  });
  prisma.billingProvider.findUnique.mockResolvedValue({ id: 'bp-1', enabled: true });
  getBillingProviderAdapter.mockReturnValue({ slug: 'pymthouse', isConfigured: () => true });
});

describe('flag OFF (zero regression)', () => {
  it('GET 404 no-op', async () => {
    isFeatureEnabled.mockResolvedValue(false);
    const res = await GET(req('http://localhost/x'), params('team-1', 'seat-1'));
    expect(res.status).toBe(404);
    expect(prisma.devApiKey.findMany).not.toHaveBeenCalled();
  });
  it('POST 404 no-op (never mints)', async () => {
    isFeatureEnabled.mockResolvedValue(false);
    const res = await POST(req('http://localhost/x', { method: 'POST', body: {} }), params('team-1', 'seat-1'));
    expect(res.status).toBe(404);
    expect(prisma.devApiKey.create).not.toHaveBeenCalled();
  });
});

describe('POST mint (flag ON)', () => {
  it('401 without token', async () => {
    const res = await POST(new NextRequest('http://localhost/x', { method: 'POST' }), params('team-1', 'seat-1'));
    expect(res.status).toBe(401);
  });

  it('mints a provider-opaque naap_ key and returns it once', async () => {
    const res = await POST(req('http://localhost/x', { method: 'POST', body: { label: 'ci' } }), params('team-1', 'seat-1'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.rawKey).toMatch(/^naap_[0-9a-f]{16}_[0-9a-f]{48}$/);
    // The created row never exposes the hash; an encrypted session ref is stored.
    const createArg = prisma.devApiKey.create.mock.calls[0][0].data;
    expect(createArg.providerSessionRefEnc).toBeTruthy();
    expect(createArg.providerSessionRefIv).toBeTruthy();
    expect(createArg.seatId).toBe('seat-1');
    expect(createArg.billingProviderId).toBe('bp-1');
    // The response must NOT leak provider tokens/URLs or the account id.
    expect(JSON.stringify(json.data)).not.toContain('acct_om_1');
    expect(JSON.stringify(json.data)).not.toContain('pmth_');
  });

  it('rejects minting when the seat is over its key limit', async () => {
    prisma.devApiKey.count.mockResolvedValue(5);
    const res = await POST(req('http://localhost/x', { method: 'POST', body: {} }), params('team-1', 'seat-1'));
    expect(res.status).toBe(403);
    expect(prisma.devApiKey.create).not.toHaveBeenCalled();
  });

  it('rejects minting when the team is not bound to a billing account', async () => {
    prisma.team.findUnique.mockResolvedValue({
      id: 'team-1',
      billingAccountProviderSlug: null,
      billingAccountId: null,
    });
    const res = await POST(req('http://localhost/x', { method: 'POST', body: {} }), params('team-1', 'seat-1'));
    expect(res.status).toBe(400);
  });

  it('rejects minting when the bound provider lacks a BillingProvider row', async () => {
    prisma.billingProvider.findUnique.mockResolvedValue(null);
    const res = await POST(req('http://localhost/x', { method: 'POST', body: {} }), params('team-1', 'seat-1'));
    expect(res.status).toBe(400);
  });

  it('forbids acting on another user\u2019s seat without admin', async () => {
    prisma.seat.findFirst.mockResolvedValue({ id: 'seat-1', userId: 'other', status: 'active', keyLimit: 5 });
    validateTeamAccess.mockImplementation(async (_u: string, _t: string, role: string) => {
      if (role === 'admin') throw new Error('Requires admin role or higher');
      return { team: { id: 'team-1' }, member: { role: 'member' } };
    });
    const res = await POST(req('http://localhost/x', { method: 'POST', body: {} }), params('team-1', 'seat-1'));
    expect(res.status).toBe(403);
  });
});

describe('GET list (flag ON)', () => {
  it('lists safe key rows for the seat', async () => {
    prisma.devApiKey.findMany.mockResolvedValue([{ id: 'key-1', keyPrefix: 'naap_abc...', status: 'ACTIVE' }]);
    const res = await GET(req('http://localhost/x'), params('team-1', 'seat-1'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.keys).toHaveLength(1);
  });
});
