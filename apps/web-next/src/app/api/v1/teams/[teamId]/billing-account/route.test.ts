/** @vitest-environment node */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

import { GET, PUT } from './route';

const isFeatureEnabled = vi.fn();
vi.mock('@/lib/feature-flags', () => ({
  isFeatureEnabled: (...a: unknown[]) => isFeatureEnabled(...a),
}));

const validateSession = vi.fn();
vi.mock('@/lib/api/auth', () => ({ validateSession: (...a: unknown[]) => validateSession(...a) }));

const validateTeamAccess = vi.fn();
vi.mock('@/lib/api/teams', () => ({
  validateTeamAccess: (...a: unknown[]) => validateTeamAccess(...a),
}));

vi.mock('@/lib/api/csrf', () => ({ validateCSRF: vi.fn(() => null) }));

const hasBillingProviderAdapter = vi.fn();
const getBillingProviderAdapter = vi.fn();
vi.mock('@/lib/billing/registry', () => ({
  hasBillingProviderAdapter: (...a: unknown[]) => hasBillingProviderAdapter(...a),
  getBillingProviderAdapter: (...a: unknown[]) => getBillingProviderAdapter(...a),
}));

const prisma = vi.hoisted(() => ({
  team: { findUnique: vi.fn(), update: vi.fn() },
}));
vi.mock('@/lib/db', () => ({ prisma }));

function req(url: string, init?: { method?: string; body?: unknown; headers?: Record<string, string> }): NextRequest {
  return new NextRequest(url, {
    method: init?.method,
    headers: { cookie: 'naap_auth_token=tok', 'content-type': 'application/json', ...(init?.headers ?? {}) },
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
}

const params = (teamId: string) => ({ params: Promise.resolve({ teamId }) });

beforeEach(() => {
  vi.clearAllMocks();
  isFeatureEnabled.mockResolvedValue(true);
  validateSession.mockResolvedValue({ id: 'user-1', roles: [] });
  validateTeamAccess.mockResolvedValue({ team: { id: 'team-1' }, member: { role: 'admin' } });
  hasBillingProviderAdapter.mockReturnValue(true);
  prisma.team.findUnique.mockResolvedValue({
    id: 'team-1',
    billingAccountProviderSlug: null,
    billingAccountId: null,
  });
  prisma.team.update.mockResolvedValue({ id: 'team-1' });
});

describe('flag OFF (zero regression)', () => {
  it('GET 404 no-op', async () => {
    isFeatureEnabled.mockResolvedValue(false);
    const res = await GET(req('http://localhost/api/v1/teams/team-1/billing-account'), params('team-1'));
    expect(res.status).toBe(404);
    expect(prisma.team.findUnique).not.toHaveBeenCalled();
  });
  it('PUT 404 no-op (never writes)', async () => {
    isFeatureEnabled.mockResolvedValue(false);
    const res = await PUT(
      req('http://localhost/api/v1/teams/team-1/billing-account', {
        method: 'PUT',
        body: { providerSlug: 'pymthouse', accountId: 'acct_1' },
      }),
      params('team-1'),
    );
    expect(res.status).toBe(404);
    expect(prisma.team.update).not.toHaveBeenCalled();
  });
});

describe('GET billing-account (flag ON)', () => {
  it('returns null for an unbound team', async () => {
    const res = await GET(req('http://localhost/api/v1/teams/team-1/billing-account'), params('team-1'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.billingAccountRef).toBeNull();
  });
  it('returns the ref for a bound team', async () => {
    prisma.team.findUnique.mockResolvedValue({
      id: 'team-1',
      billingAccountProviderSlug: 'pymthouse',
      billingAccountId: 'acct_om_1',
    });
    const res = await GET(req('http://localhost/api/v1/teams/team-1/billing-account'), params('team-1'));
    const json = await res.json();
    expect(json.data.billingAccountRef).toEqual({ providerSlug: 'pymthouse', accountId: 'acct_om_1' });
  });
});

describe('PUT billing-account (flag ON)', () => {
  it('requires admin', async () => {
    validateTeamAccess.mockRejectedValue(new Error('Requires admin role or higher'));
    const res = await PUT(
      req('http://localhost/api/v1/teams/team-1/billing-account', {
        method: 'PUT',
        body: { providerSlug: 'pymthouse', accountId: 'acct_1' },
      }),
      params('team-1'),
    );
    expect(res.status).toBe(403);
  });
  it('400 for a malformed ref', async () => {
    const res = await PUT(
      req('http://localhost/api/v1/teams/team-1/billing-account', { method: 'PUT', body: { providerSlug: 'x' } }),
      params('team-1'),
    );
    expect(res.status).toBe(400);
    expect(prisma.team.update).not.toHaveBeenCalled();
  });
  it('400 when provider has no registered adapter (stays generic)', async () => {
    hasBillingProviderAdapter.mockReturnValue(false);
    const res = await PUT(
      req('http://localhost/api/v1/teams/team-1/billing-account', {
        method: 'PUT',
        body: { providerSlug: 'nope', accountId: 'acct_1' },
      }),
      params('team-1'),
    );
    expect(res.status).toBe(400);
    expect(prisma.team.update).not.toHaveBeenCalled();
  });
  it('binds a valid ref via the adapter registry (pymthouse)', async () => {
    const res = await PUT(
      req('http://localhost/api/v1/teams/team-1/billing-account', {
        method: 'PUT',
        body: { providerSlug: 'Pymthouse', accountId: ' acct_om_1 ' },
      }),
      params('team-1'),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.billingAccountRef).toEqual({ providerSlug: 'pymthouse', accountId: 'acct_om_1' });
    expect(prisma.team.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { billingAccountProviderSlug: 'pymthouse', billingAccountId: 'acct_om_1' },
      }),
    );
  });
  it('binds against the C0 stub provider too (provider-agnostic)', async () => {
    const res = await PUT(
      req('http://localhost/api/v1/teams/team-1/billing-account', {
        method: 'PUT',
        body: { providerSlug: 'stub', accountId: 'acct_stub_1' },
      }),
      params('team-1'),
    );
    expect(res.status).toBe(200);
  });
});
