/** @vitest-environment node */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

import { GET, POST } from './route';

const isFeatureEnabled = vi.fn();
vi.mock('@/lib/feature-flags', () => ({
  isFeatureEnabled: (...a: unknown[]) => isFeatureEnabled(...a),
  MULTI_SUBSCRIPTION_FLAG: 'multi_subscription',
}));

const validateSession = vi.fn();
vi.mock('@/lib/api/auth', () => ({ validateSession: (...a: unknown[]) => validateSession(...a) }));

const validateTeamAccess = vi.fn();
vi.mock('@/lib/api/teams', () => ({ validateTeamAccess: (...a: unknown[]) => validateTeamAccess(...a) }));

vi.mock('@/lib/api/csrf', () => ({ validateCSRF: vi.fn(() => null) }));

const prisma = vi.hoisted(() => ({
  subscription: { findFirst: vi.fn() },
  seat: { findFirst: vi.fn() },
  devApiKey: { findMany: vi.fn(), count: vi.fn(), create: vi.fn() },
  providerInstance: { findUnique: vi.fn() },
  billingProvider: { findUnique: vi.fn() },
}));
vi.mock('@/lib/db', () => ({ prisma }));

function req(init?: { method?: string; body?: unknown }): NextRequest {
  return new NextRequest('http://localhost/x', {
    method: init?.method,
    headers: { cookie: 'naap_auth_token=tok', 'content-type': 'application/json' },
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
}

const params = (teamId: string, subId: string) => ({ params: Promise.resolve({ teamId, subId }) });

beforeEach(() => {
  vi.clearAllMocks();
  isFeatureEnabled.mockResolvedValue(true);
  validateSession.mockResolvedValue({ id: 'user-1' });
  validateTeamAccess.mockResolvedValue({ team: { id: 'team-1' }, member: { role: 'member' } });
  prisma.subscription.findFirst.mockResolvedValue({
    id: 'sub-1', providerInstanceId: 'inst-1', accountId: 'acct_sub_42', status: 'active',
  });
  prisma.seat.findFirst.mockResolvedValue({ id: 'seat-1', userId: 'user-1', status: 'active', keyLimit: 5 });
  prisma.devApiKey.findMany.mockResolvedValue([]);
  prisma.devApiKey.count.mockResolvedValue(0);
  prisma.providerInstance.findUnique.mockResolvedValue({ id: 'inst-1', adapterType: 'pymthouse', enabled: true });
  prisma.billingProvider.findUnique.mockResolvedValue({ id: 'bp-1', enabled: true });
  prisma.devApiKey.create.mockImplementation(async ({ data, select: _s }: { data: Record<string, unknown>; select: unknown }) => ({
    id: 'key-1',
    keyPrefix: data.keyPrefix,
    label: data.label ?? null,
    status: data.status,
    seatId: data.seatId,
    teamId: data.teamId,
    subscriptionId: data.subscriptionId,
    createdAt: new Date(),
    lastUsedAt: null,
    revokedAt: null,
  }));
});

describe('flag OFF (zero regression)', () => {
  it('GET 404 no-op', async () => {
    isFeatureEnabled.mockResolvedValue(false);
    const res = await GET(req(), params('team-1', 'sub-1'));
    expect(res.status).toBe(404);
    expect(prisma.devApiKey.findMany).not.toHaveBeenCalled();
  });
  it('POST 404 no-op (never mints)', async () => {
    isFeatureEnabled.mockResolvedValue(false);
    const res = await POST(req({ method: 'POST', body: {} }), params('team-1', 'sub-1'));
    expect(res.status).toBe(404);
    expect(prisma.devApiKey.create).not.toHaveBeenCalled();
  });
});

describe('POST mint (flag ON)', () => {
  it('mints a naap_ key bound to the subscription and returns it once', async () => {
    const res = await POST(req({ method: 'POST', body: { label: 'ci' } }), params('team-1', 'sub-1'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.rawKey).toMatch(/^naap_[0-9a-f]{16}_[0-9a-f]{48}$/);
    const createArg = prisma.devApiKey.create.mock.calls[0][0].data;
    expect(createArg.subscriptionId).toBe('sub-1');
    expect(createArg.seatId).toBe('seat-1');
    expect(createArg.billingProviderId).toBe('bp-1');
    expect(createArg.providerSessionRefEnc).toBeTruthy();
    // Never leak the opaque account pointer in the response.
    expect(JSON.stringify(json.data)).not.toContain('acct_sub_42');
  });

  it('404 when the subscription does not belong to the team', async () => {
    prisma.subscription.findFirst.mockResolvedValue(null);
    const res = await POST(req({ method: 'POST', body: {} }), params('team-1', 'sub-1'));
    expect(res.status).toBe(404);
    expect(prisma.devApiKey.create).not.toHaveBeenCalled();
  });

  it('400 when the subscription is not active', async () => {
    prisma.subscription.findFirst.mockResolvedValue({ id: 'sub-1', providerInstanceId: 'inst-1', accountId: 'a', status: 'canceled' });
    const res = await POST(req({ method: 'POST', body: {} }), params('team-1', 'sub-1'));
    expect(res.status).toBe(400);
  });

  it('403 when the caller has no active seat', async () => {
    prisma.seat.findFirst.mockResolvedValue(null);
    const res = await POST(req({ method: 'POST', body: {} }), params('team-1', 'sub-1'));
    expect(res.status).toBe(403);
  });

  it('403 when the seat is over its key limit', async () => {
    prisma.devApiKey.count.mockResolvedValue(5);
    const res = await POST(req({ method: 'POST', body: {} }), params('team-1', 'sub-1'));
    expect(res.status).toBe(403);
    expect(prisma.devApiKey.create).not.toHaveBeenCalled();
  });
});

describe('GET list (flag ON)', () => {
  it('lists keys scoped to the subscription + team', async () => {
    prisma.devApiKey.findMany.mockResolvedValue([{ id: 'key-1', keyPrefix: 'naap_abc...', status: 'ACTIVE', subscriptionId: 'sub-1' }]);
    const res = await GET(req(), params('team-1', 'sub-1'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.keys).toHaveLength(1);
    expect(prisma.devApiKey.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { subscriptionId: 'sub-1', teamId: 'team-1' } }),
    );
  });
});
