/** @vitest-environment node */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

import { GET } from './route';

const isFeatureEnabled = vi.fn();
vi.mock('@/lib/feature-flags', () => ({
  isFeatureEnabled: (...a: unknown[]) => isFeatureEnabled(...a),
  MULTI_SUBSCRIPTION_FLAG: 'multi_subscription',
}));

const validateSession = vi.fn();
vi.mock('@/lib/api/auth', () => ({ validateSession: (...a: unknown[]) => validateSession(...a) }));

const validateTeamAccess = vi.fn();
vi.mock('@/lib/api/teams', () => ({ validateTeamAccess: (...a: unknown[]) => validateTeamAccess(...a) }));

const prisma = vi.hoisted(() => ({
  devApiKey: { findFirst: vi.fn() },
  devApiUsageLog: { aggregate: vi.fn(), findMany: vi.fn() },
}));
vi.mock('@/lib/db', () => ({ prisma }));

function req(): NextRequest {
  return new NextRequest('http://localhost/x', { headers: { cookie: 'naap_auth_token=tok' } });
}

const params = (teamId: string, subId: string, keyId: string) => ({ params: Promise.resolve({ teamId, subId, keyId }) });

beforeEach(() => {
  vi.clearAllMocks();
  isFeatureEnabled.mockResolvedValue(true);
  validateSession.mockResolvedValue({ id: 'user-1' });
  validateTeamAccess.mockResolvedValue({ team: { id: 'team-1' }, member: { role: 'member' } });
  prisma.devApiKey.findFirst.mockResolvedValue({ id: 'key-1' });
  prisma.devApiUsageLog.aggregate.mockResolvedValue({ _sum: { requestCount: 12, tokensUsed: 340, costIncurred: 1.5 } });
  prisma.devApiUsageLog.findMany.mockResolvedValue([
    { id: 'log-1', requestCount: 2, tokensUsed: 40, costIncurred: 0.25, timestamp: new Date('2026-01-01T00:00:00Z') },
  ]);
});

describe('GET per-key usage', () => {
  it('INV: 404 no-op when flag OFF; never reads usage', async () => {
    isFeatureEnabled.mockResolvedValue(false);
    const res = await GET(req(), params('team-1', 'sub-1', 'key-1'));
    expect(res.status).toBe(404);
    expect(prisma.devApiUsageLog.aggregate).not.toHaveBeenCalled();
  });

  it('INV-scoping: 404 when the key is not in this team+subscription', async () => {
    prisma.devApiKey.findFirst.mockResolvedValue(null);
    const res = await GET(req(), params('team-1', 'sub-1', 'key-foreign'));
    expect(res.status).toBe(404);
    expect(prisma.devApiUsageLog.aggregate).not.toHaveBeenCalled();
    // The key lookup is scoped to BOTH the team and the subscription.
    expect(prisma.devApiKey.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'key-foreign', teamId: 'team-1', subscriptionId: 'sub-1' } }),
    );
  });

  it('returns per-key totals + recent entries scoped to the key', async () => {
    const res = await GET(req(), params('team-1', 'sub-1', 'key-1'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.keyId).toBe('key-1');
    expect(json.data.subscriptionId).toBe('sub-1');
    expect(json.data.totals).toEqual({ requestCount: 12, tokensUsed: 340, costIncurred: 1.5 });
    expect(json.data.entries).toHaveLength(1);
    expect(prisma.devApiUsageLog.aggregate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { apiKeyId: 'key-1' } }),
    );
  });

  it('coerces null sums to 0', async () => {
    prisma.devApiUsageLog.aggregate.mockResolvedValue({ _sum: { requestCount: null, tokensUsed: null, costIncurred: null } });
    prisma.devApiUsageLog.findMany.mockResolvedValue([]);
    const res = await GET(req(), params('team-1', 'sub-1', 'key-1'));
    const json = await res.json();
    expect(json.data.totals).toEqual({ requestCount: 0, tokensUsed: 0, costIncurred: 0 });
  });
});
