/** @vitest-environment node */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

import { GET } from './route';

const isFeatureEnabled = vi.fn();
vi.mock('@/lib/feature-flags', () => ({
  isFeatureEnabled: (...a: unknown[]) => isFeatureEnabled(...a),
}));

const validateSession = vi.fn();
vi.mock('@/lib/api/auth', () => ({
  validateSession: (...a: unknown[]) => validateSession(...a),
}));

const teamFindMany = vi.fn();
const usageFindMany = vi.fn();
vi.mock('@/lib/db', () => ({
  prisma: {
    team: { findMany: (...a: unknown[]) => teamFindMany(...a) },
    providerUsageRecord: { findMany: (...a: unknown[]) => usageFindMany(...a) },
  },
}));

function req(query = ''): NextRequest {
  return new NextRequest(`https://naap.test/api/v1/metrics/usage${query}`, {
    method: 'GET',
    headers: { authorization: 'Bearer session-token' },
  });
}

const SELF_ACCOUNT = 'acct_self';
const OTHER_ACCOUNT = 'acct_other';

function usageRow(accountId: string, providerSlug = 'pymthouse') {
  return {
    providerSlug,
    accountId,
    appId: null,
    sessions: 1,
    tickets: 10,
    feeWei: '1000',
    networkFeeUsdMicros: '5000',
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  isFeatureEnabled.mockResolvedValue(true);
});

describe('usage_ingest flag OFF → no-op', () => {
  it('returns 404 and never authenticates or queries', async () => {
    isFeatureEnabled.mockResolvedValue(false);
    const res = await GET(req());
    expect(res.status).toBe(404);
    expect(validateSession).not.toHaveBeenCalled();
    expect(usageFindMany).not.toHaveBeenCalled();
  });
});

describe('cross-tenant spend scoping', () => {
  it('forbids a non-member from reading another account', async () => {
    validateSession.mockResolvedValue({ id: 'user-1', roles: ['user'] });
    // Caller belongs to a team bound only to their own account.
    teamFindMany.mockResolvedValue([
      { billingAccountProviderSlug: 'pymthouse', billingAccountId: SELF_ACCOUNT },
    ]);

    const res = await GET(req(`?accountId=${OTHER_ACCOUNT}`));

    expect(res.status).toBe(403);
    expect(usageFindMany).not.toHaveBeenCalled();
  });

  it('returns only the caller\'s accounts when no accountId is given', async () => {
    validateSession.mockResolvedValue({ id: 'user-1', roles: ['user'] });
    teamFindMany.mockResolvedValue([
      { billingAccountProviderSlug: 'pymthouse', billingAccountId: SELF_ACCOUNT },
    ]);
    usageFindMany.mockResolvedValue([usageRow(SELF_ACCOUNT)]);

    const res = await GET(req());

    expect(res.status).toBe(200);
    expect(usageFindMany).toHaveBeenCalledTimes(1);
    const where = usageFindMany.mock.calls[0][0].where as {
      OR: Array<{ providerSlug: string; accountId: string }>;
    };
    // Query is constrained to the caller's own ref — never an unbounded scan.
    expect(where.OR).toEqual([{ providerSlug: 'pymthouse', accountId: SELF_ACCOUNT }]);
    const json = await res.json();
    expect(json.data.providers).toHaveLength(1);
    expect(json.data.providers[0].accounts).toBe(1);
  });

  it('returns empty (not all accounts) for a caller with no billing accounts', async () => {
    validateSession.mockResolvedValue({ id: 'user-1', roles: ['user'] });
    teamFindMany.mockResolvedValue([]);

    const res = await GET(req());

    expect(res.status).toBe(200);
    // Never falls back to an unscoped query.
    expect(usageFindMany).not.toHaveBeenCalled();
    const json = await res.json();
    expect(json.data.providers).toEqual([]);
  });

  it('lets system:admin query any account', async () => {
    validateSession.mockResolvedValue({ id: 'admin-1', roles: ['system:admin'] });
    usageFindMany.mockResolvedValue([usageRow(OTHER_ACCOUNT)]);

    const res = await GET(req(`?accountId=${OTHER_ACCOUNT}`));

    expect(res.status).toBe(200);
    // Admin bypasses team scoping entirely.
    expect(teamFindMany).not.toHaveBeenCalled();
    const where = usageFindMany.mock.calls[0][0].where as { accountId?: string };
    expect(where.accountId).toBe(OTHER_ACCOUNT);
  });

  it('lets system:admin query across all accounts when no accountId is given', async () => {
    validateSession.mockResolvedValue({ id: 'admin-1', roles: ['system:admin'] });
    usageFindMany.mockResolvedValue([usageRow(SELF_ACCOUNT), usageRow(OTHER_ACCOUNT)]);

    const res = await GET(req());

    expect(res.status).toBe(200);
    const where = usageFindMany.mock.calls[0][0].where as Record<string, unknown>;
    expect(where.accountId).toBeUndefined();
    expect(where.OR).toBeUndefined();
  });

  it('rejects an unauthenticated request', async () => {
    validateSession.mockResolvedValue(null);
    const res = await GET(req());
    expect(res.status).toBe(401);
    expect(usageFindMany).not.toHaveBeenCalled();
  });
});
