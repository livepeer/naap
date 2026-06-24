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
  subscription: { findMany: vi.fn(), create: vi.fn() },
  providerInstance: { findUnique: vi.fn() },
  team: { findUnique: vi.fn() },
}));
vi.mock('@/lib/db', () => ({ prisma }));

function req(init?: { method?: string; body?: unknown }): NextRequest {
  return new NextRequest('http://localhost/x', {
    method: init?.method,
    headers: { cookie: 'naap_auth_token=tok', 'content-type': 'application/json' },
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
}

const params = (teamId: string) => ({ params: Promise.resolve({ teamId }) });

beforeEach(() => {
  vi.clearAllMocks();
  isFeatureEnabled.mockResolvedValue(true);
  validateSession.mockResolvedValue({ id: 'user-1' });
  validateTeamAccess.mockResolvedValue({ team: { id: 'team-1' }, member: { role: 'admin' } });
  prisma.subscription.findMany.mockResolvedValue([]);
  prisma.providerInstance.findUnique.mockResolvedValue({ id: 'inst-1', enabled: true });
  prisma.team.findUnique.mockResolvedValue({ billingAccountId: 'acct_team_1' });
  prisma.subscription.create.mockImplementation(async ({ data, select: _s }: { data: Record<string, unknown>; select: unknown }) => ({
    id: 'sub-1',
    teamId: data.teamId,
    providerInstanceId: data.providerInstanceId,
    providerPlanId: data.providerPlanId ?? null,
    accountId: data.accountId,
    status: data.status,
    appId: data.appId ?? null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
  }));
});

describe('flag OFF (zero regression)', () => {
  it('GET 404 no-op', async () => {
    isFeatureEnabled.mockResolvedValue(false);
    const res = await GET(req(), params('team-1'));
    expect(res.status).toBe(404);
    expect(prisma.subscription.findMany).not.toHaveBeenCalled();
  });
  it('POST 404 no-op (never creates)', async () => {
    isFeatureEnabled.mockResolvedValue(false);
    const res = await POST(req({ method: 'POST', body: { providerInstanceId: 'inst-1' } }), params('team-1'));
    expect(res.status).toBe(404);
    expect(prisma.subscription.create).not.toHaveBeenCalled();
  });
});

describe('GET list (flag ON)', () => {
  it('forbids a non-member', async () => {
    validateTeamAccess.mockRejectedValue(new Error('Not a member of this team'));
    const res = await GET(req(), params('team-1'));
    expect(res.status).toBe(403);
  });
  it('lists the team subscriptions (tenant-scoped)', async () => {
    prisma.subscription.findMany.mockResolvedValue([
      { id: 'sub-1', teamId: 'team-1', providerInstanceId: 'inst-1', providerPlanId: null, accountId: 'acct_x', status: 'active', appId: null, createdAt: new Date('2026-01-01Z'), updatedAt: new Date('2026-01-01Z') },
    ]);
    const res = await GET(req(), params('team-1'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.subscriptions).toHaveLength(1);
    expect(prisma.subscription.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { teamId: 'team-1' } }),
    );
  });
});

describe('POST create (flag ON)', () => {
  it('requires admin', async () => {
    validateTeamAccess.mockImplementation(async (_u: string, _t: string, role: string) => {
      if (role === 'admin') throw new Error('Requires admin role or higher');
      return { team: { id: 'team-1' }, member: { role: 'member' } };
    });
    const res = await POST(req({ method: 'POST', body: { providerInstanceId: 'inst-1' } }), params('team-1'));
    expect(res.status).toBe(403);
    expect(prisma.subscription.create).not.toHaveBeenCalled();
  });

  it('400 when providerInstanceId is missing', async () => {
    const res = await POST(req({ method: 'POST', body: {} }), params('team-1'));
    expect(res.status).toBe(400);
  });

  it('400 for an unknown/disabled instance', async () => {
    prisma.providerInstance.findUnique.mockResolvedValue(null);
    const res = await POST(req({ method: 'POST', body: { providerInstanceId: 'bad' } }), params('team-1'));
    expect(res.status).toBe(400);
  });

  it('creates a subscription, defaulting accountId to the team binding', async () => {
    const res = await POST(req({ method: 'POST', body: { providerInstanceId: 'inst-1' } }), params('team-1'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.subscription.providerInstanceId).toBe('inst-1');
    expect(json.data.subscription.status).toBe('active');
    const createArg = prisma.subscription.create.mock.calls[0][0].data;
    expect(createArg.teamId).toBe('team-1');
    expect(createArg.accountId).toBe('acct_team_1');
  });

  it('400 when no accountId provided and the team is unbound', async () => {
    prisma.team.findUnique.mockResolvedValue({ billingAccountId: null });
    const res = await POST(req({ method: 'POST', body: { providerInstanceId: 'inst-1' } }), params('team-1'));
    expect(res.status).toBe(400);
  });

  it('uses a caller-supplied accountId when given', async () => {
    const res = await POST(
      req({ method: 'POST', body: { providerInstanceId: 'inst-1', accountId: 'acct_custom' } }),
      params('team-1'),
    );
    expect(res.status).toBe(200);
    expect(prisma.subscription.create.mock.calls[0][0].data.accountId).toBe('acct_custom');
  });
});
