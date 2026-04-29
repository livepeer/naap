/** @vitest-environment node */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { PmtHouseError } from '@pymthouse/builder-api';
import type { AuthUser } from '@naap/types';

import { GET } from '@/app/api/v1/billing/pymthouse/usage/route';

const getUsage = vi.fn();

vi.mock('@/lib/pymthouse-client', () => ({
  getPmtHouseServerClient: vi.fn(() => ({ getUsage })),
  resetPmtHouseServerClientForTests: vi.fn(),
}));

const validateSession = vi.fn();

vi.mock('@/lib/api/auth', () => ({
  validateSession: (...args: unknown[]) => validateSession(...args),
}));

function authUser(overrides: Partial<AuthUser> = {}): AuthUser {
  return {
    id: 'user-naap-1',
    email: null,
    displayName: null,
    avatarUrl: null,
    address: null,
    roles: [],
    permissions: [],
    ...overrides,
  };
}

describe('GET /api/v1/billing/pymthouse/usage', () => {
  const env: Record<string, string | undefined> = {};

  beforeEach(() => {
    env.PYMTHOUSE_ISSUER_URL = process.env.PYMTHOUSE_ISSUER_URL;
    env.PYMTHOUSE_PUBLIC_CLIENT_ID = process.env.PYMTHOUSE_PUBLIC_CLIENT_ID;
    env.PYMTHOUSE_M2M_CLIENT_ID = process.env.PYMTHOUSE_M2M_CLIENT_ID;
    env.PYMTHOUSE_M2M_CLIENT_SECRET = process.env.PYMTHOUSE_M2M_CLIENT_SECRET;

    process.env.PYMTHOUSE_ISSUER_URL = 'http://localhost:3001/api/v1/oidc';
    process.env.PYMTHOUSE_PUBLIC_CLIENT_ID = 'app_pub1';
    process.env.PYMTHOUSE_M2M_CLIENT_ID = 'm2m_sec1';
    process.env.PYMTHOUSE_M2M_CLIENT_SECRET = 'secret';

    vi.clearAllMocks();
    validateSession.mockResolvedValue(authUser());
    getUsage.mockResolvedValue({
      clientId: 'app_pub1',
      period: { start: '2025-01-01T00:00:00.000Z', end: '2025-01-31T23:59:59.999Z' },
      totals: { requestCount: 10, totalFeeWei: '100' },
      byUser: [
        {
          endUserId: 'ph-internal',
          externalUserId: 'user-naap-1',
          requestCount: 3,
          feeWei: '42',
        },
      ],
    });
  });

  afterEach(() => {
    process.env.PYMTHOUSE_ISSUER_URL = env.PYMTHOUSE_ISSUER_URL;
    process.env.PYMTHOUSE_PUBLIC_CLIENT_ID = env.PYMTHOUSE_PUBLIC_CLIENT_ID;
    process.env.PYMTHOUSE_M2M_CLIENT_ID = env.PYMTHOUSE_M2M_CLIENT_ID;
    process.env.PYMTHOUSE_M2M_CLIENT_SECRET = env.PYMTHOUSE_M2M_CLIENT_SECRET;
  });

  it('scope=me forces groupBy user and returns only the current user row', async () => {
    const req = new NextRequest('http://localhost/api/v1/billing/pymthouse/usage?scope=me', {
      headers: { cookie: 'naap_auth_token=tok' },
    });
    const res = await GET(req);
    expect(res.status).toBe(200);
    expect(getUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        groupBy: 'user',
      }),
    );
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.currentUser.externalUserId).toBe('user-naap-1');
    expect(json.data.currentUser.requestCount).toBe(3);
    expect(json.data.currentUser.feeWei).toBe('42');
    expect(json.data.totals).toBeUndefined();
  });

  it('scope=app returns 403 for non-admin', async () => {
    validateSession.mockResolvedValue(authUser({ roles: ['user'] }));
    const req = new NextRequest('http://localhost/api/v1/billing/pymthouse/usage?scope=app', {
      headers: { cookie: 'naap_auth_token=tok' },
    });
    const res = await GET(req);
    expect(res.status).toBe(403);
    expect(getUsage).not.toHaveBeenCalled();
  });

  it('scope=app passes groupBy and userId for system:admin', async () => {
    validateSession.mockResolvedValue(authUser({ roles: ['system:admin'] }));
    const req = new NextRequest(
      'http://localhost/api/v1/billing/pymthouse/usage?scope=app&groupBy=none&userId=internal-1&startDate=2025-01-01&endDate=2025-01-31',
      { headers: { cookie: 'naap_auth_token=tok' } },
    );
    const res = await GET(req);
    expect(res.status).toBe(200);
    expect(getUsage).toHaveBeenCalledWith({
      startDate: '2025-01-01',
      endDate: '2025-01-31',
      groupBy: 'none',
      userId: 'internal-1',
    });
  });

  it('returns 400 when only one of startDate/endDate is set', async () => {
    const req = new NextRequest(
      'http://localhost/api/v1/billing/pymthouse/usage?scope=me&startDate=2025-01-01',
      { headers: { cookie: 'naap_auth_token=tok' } },
    );
    const res = await GET(req);
    expect(res.status).toBe(400);
    expect(getUsage).not.toHaveBeenCalled();
  });

  it('returns 400 for invalid groupBy on scope=app', async () => {
    validateSession.mockResolvedValue(authUser({ roles: ['system:admin'] }));
    const req = new NextRequest(
      'http://localhost/api/v1/billing/pymthouse/usage?scope=app&groupBy=bad',
      { headers: { cookie: 'naap_auth_token=tok' } },
    );
    const res = await GET(req);
    expect(res.status).toBe(400);
  });

  it('maps upstream PmtHouseError 404 to generic not found', async () => {
    getUsage.mockRejectedValue(new PmtHouseError('missing', { status: 404, code: 'NOT_FOUND' }));
    const req = new NextRequest('http://localhost/api/v1/billing/pymthouse/usage?scope=me', {
      headers: { cookie: 'naap_auth_token=tok' },
    });
    const res = await GET(req);
    expect(res.status).toBe(404);
  });
});
