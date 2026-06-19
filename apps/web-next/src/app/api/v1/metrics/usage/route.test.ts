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

// Isolate the route from the pull lib internals: the lib is unit-tested
// separately. `spendScopeKey` keeps its real (trivial) shape so the route's DB
// exclusion logic is exercised faithfully.
const pullSpend = vi.fn();
const listPullCapableProviderSlugs = vi.fn();
vi.mock('@/lib/metrics/usage-pull', () => ({
  pullSpend: (...a: unknown[]) => pullSpend(...a),
  listPullCapableProviderSlugs: () => listPullCapableProviderSlugs(),
  spendScopeKey: (s: { providerSlug: string; accountId?: string }) =>
    `${s.providerSlug}\u0000${s.accountId ?? '*app*'}`,
}));

const FLAGS = { usage_ingest: true, usage_pull: false };

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

function scopeKey(providerSlug: string, accountId?: string) {
  return `${providerSlug}\u0000${accountId ?? '*app*'}`;
}

beforeEach(() => {
  vi.clearAllMocks();
  FLAGS.usage_ingest = true;
  FLAGS.usage_pull = false;
  isFeatureEnabled.mockImplementation(async (key: string) => FLAGS[key as keyof typeof FLAGS]);
  listPullCapableProviderSlugs.mockReturnValue(['pymthouse']);
});

describe('usage_ingest flag OFF → no-op', () => {
  it('returns 404 and never authenticates or queries', async () => {
    FLAGS.usage_ingest = false;
    const res = await GET(req());
    expect(res.status).toBe(404);
    expect(validateSession).not.toHaveBeenCalled();
    expect(usageFindMany).not.toHaveBeenCalled();
  });
});

describe('cross-tenant spend scoping (usage_pull OFF → reads ProviderUsageRecord)', () => {
  it('never pulls when usage_pull is OFF', async () => {
    validateSession.mockResolvedValue({ id: 'user-1', roles: ['user'] });
    teamFindMany.mockResolvedValue([
      { billingAccountProviderSlug: 'pymthouse', billingAccountId: SELF_ACCOUNT },
    ]);
    usageFindMany.mockResolvedValue([usageRow(SELF_ACCOUNT)]);

    await GET(req());

    expect(pullSpend).not.toHaveBeenCalled();
    expect(usageFindMany).toHaveBeenCalledTimes(1);
  });

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

  it("returns only the caller's accounts when no accountId is given", async () => {
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

describe('usage_pull flag ON → pull-first with fallback', () => {
  beforeEach(() => {
    FLAGS.usage_pull = true;
  });

  it("pulls the caller's ref live and does NOT read the DB for pulled scopes", async () => {
    validateSession.mockResolvedValue({ id: 'user-1', roles: ['user'] });
    teamFindMany.mockResolvedValue([
      { billingAccountProviderSlug: 'pymthouse', billingAccountId: SELF_ACCOUNT },
    ]);
    pullSpend.mockResolvedValue({
      records: [
        {
          providerSlug: 'pymthouse',
          accountId: SELF_ACCOUNT,
          sessions: 0,
          tickets: 42,
          feeWei: null,
          networkFeeUsdMicros: '9000',
          byCapability: { 'text-to-image:sdxl': { tickets: 42, networkFeeUsdMicros: '9000' } },
        },
      ],
      pulled: new Set([scopeKey('pymthouse', SELF_ACCOUNT)]),
    });

    const res = await GET(req());

    expect(res.status).toBe(200);
    // Scoped to the caller's authorized ref only (tenant boundary preserved).
    expect(pullSpend).toHaveBeenCalledTimes(1);
    expect(pullSpend.mock.calls[0][0]).toEqual([
      { providerSlug: 'pymthouse', accountId: SELF_ACCOUNT },
    ]);
    // Pulled ⇒ no DB backfill for that ref.
    expect(usageFindMany).not.toHaveBeenCalled();
    const json = await res.json();
    expect(json.data.providers).toHaveLength(1);
    expect(json.data.providers[0].tickets).toBe(42);
    expect(json.data.providers[0].byCapability).toEqual({
      'text-to-image:sdxl': { tickets: 42, networkFeeUsdMicros: '9000' },
    });
  });

  it('falls back to ProviderUsageRecord when the live pull yields nothing', async () => {
    validateSession.mockResolvedValue({ id: 'user-1', roles: ['user'] });
    teamFindMany.mockResolvedValue([
      { billingAccountProviderSlug: 'pymthouse', billingAccountId: SELF_ACCOUNT },
    ]);
    // Simulate a failed/empty pull (graceful degradation contract).
    pullSpend.mockResolvedValue({ records: [], pulled: new Set<string>() });
    usageFindMany.mockResolvedValue([usageRow(SELF_ACCOUNT)]);

    const res = await GET(req());

    expect(res.status).toBe(200);
    expect(usageFindMany).toHaveBeenCalledTimes(1);
    const where = usageFindMany.mock.calls[0][0].where as {
      OR: Array<{ providerSlug: string; accountId: string }>;
    };
    expect(where.OR).toEqual([{ providerSlug: 'pymthouse', accountId: SELF_ACCOUNT }]);
    const json = await res.json();
    expect(json.data.providers[0].tickets).toBe(10); // from the DB row
  });

  it('never 500s: a thrown pull orchestration degrades to the full DB read', async () => {
    validateSession.mockResolvedValue({ id: 'user-1', roles: ['user'] });
    teamFindMany.mockResolvedValue([
      { billingAccountProviderSlug: 'pymthouse', billingAccountId: SELF_ACCOUNT },
    ]);
    pullSpend.mockRejectedValue(new Error('boom'));
    usageFindMany.mockResolvedValue([usageRow(SELF_ACCOUNT)]);

    const res = await GET(req());

    expect(res.status).toBe(200);
    expect(usageFindMany).toHaveBeenCalledTimes(1);
    const json = await res.json();
    expect(json.data.providers[0].tickets).toBe(10);
  });

  it('does not pull and does not 403-bypass: a forbidden account never reaches the pull', async () => {
    validateSession.mockResolvedValue({ id: 'user-1', roles: ['user'] });
    teamFindMany.mockResolvedValue([
      { billingAccountProviderSlug: 'pymthouse', billingAccountId: SELF_ACCOUNT },
    ]);

    const res = await GET(req(`?accountId=${OTHER_ACCOUNT}`));

    expect(res.status).toBe(403);
    expect(pullSpend).not.toHaveBeenCalled();
    expect(usageFindMany).not.toHaveBeenCalled();
  });

  it('admin app-wide: pulls pull-capable providers and excludes them from the DB read', async () => {
    validateSession.mockResolvedValue({ id: 'admin-1', roles: ['system:admin'] });
    pullSpend.mockResolvedValue({
      records: [
        { providerSlug: 'pymthouse', accountId: 'u1', sessions: 0, tickets: 7, networkFeeUsdMicros: '700' },
      ],
      pulled: new Set([scopeKey('pymthouse')]),
    });
    // A push-only provider (stub) is still served from the DB.
    usageFindMany.mockResolvedValue([usageRow('acct_x', 'stub')]);

    const res = await GET(req());

    expect(res.status).toBe(200);
    // Admin app-wide ⇒ pull each capable provider with no accountId (app-wide).
    expect(pullSpend.mock.calls[0][0]).toEqual([{ providerSlug: 'pymthouse' }]);
    const where = usageFindMany.mock.calls[0][0].where as {
      providerSlug?: { notIn: string[] };
    };
    expect(where.providerSlug).toEqual({ notIn: ['pymthouse'] });
    const json = await res.json();
    const slugs = json.data.providers.map((p: { providerSlug: string }) => p.providerSlug).sort();
    expect(slugs).toEqual(['pymthouse', 'stub']);
  });
});
