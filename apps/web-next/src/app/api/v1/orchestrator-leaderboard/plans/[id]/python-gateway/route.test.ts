import { NextRequest } from 'next/server';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/gateway/authorize', () => ({
  authorize: vi.fn(),
}));

vi.mock('@/lib/orchestrator-leaderboard/plans', () => ({
  getPlan: vi.fn(),
}));

vi.mock('@/lib/orchestrator-leaderboard/refresh', () => ({
  evaluateAndCache: vi.fn(),
}));

vi.mock('@/lib/orchestrator-leaderboard/discovery-order', () => ({
  tieredShuffleDiscoveryAddresses: (addresses: string[]) => [...addresses],
}));

import { authorize } from '@/lib/gateway/authorize';
import { getPlan } from '@/lib/orchestrator-leaderboard/plans';
import { evaluateAndCache } from '@/lib/orchestrator-leaderboard/refresh';

describe('GET /api/v1/orchestrator-leaderboard/plans/:id/python-gateway', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (authorize as ReturnType<typeof vi.fn>).mockResolvedValue({
      authenticated: true,
      teamId: 'personal:user-1',
      callerType: 'jwt',
      callerId: 'user-1',
    });
    (getPlan as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'plan-1',
      billingPlanId: 'bp-1',
      name: 'Test',
      description: null,
      teamId: null,
      ownerUserId: 'user-1',
      capabilities: ['cap-a', 'cap-b'],
      topN: 10,
      slaWeights: null,
      slaMinScore: null,
      sortBy: null,
      filters: null,
      enabled: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    (evaluateAndCache as ReturnType<typeof vi.fn>).mockResolvedValue({
      planId: 'plan-1',
      refreshedAt: new Date().toISOString(),
      capabilities: {
        'cap-a': [
          { orchUri: 'https://dup.test', gpuName: 'x', gpuGb: 1, avail: 1, totalCap: 1, pricePerUnit: 1, bestLatMs: null, avgLatMs: null, swapRatio: null, avgAvail: null },
          { orchUri: 'https://dup.test', gpuName: 'x', gpuGb: 1, avail: 1, totalCap: 1, pricePerUnit: 1, bestLatMs: null, avgLatMs: null, swapRatio: null, avgAvail: null },
          { orchUri: 'https://orch-b.test', gpuName: 'x', gpuGb: 1, avail: 1, totalCap: 1, pricePerUnit: 1, bestLatMs: null, avgLatMs: null, swapRatio: null, avgAvail: null },
        ],
        'cap-b': [{ orchUri: 'https://orch-a.test', gpuName: 'x', gpuGb: 1, avail: 1, totalCap: 1, pricePerUnit: 1, bestLatMs: null, avgLatMs: null, swapRatio: null, avgAvail: null }],
      },
      meta: { totalOrchestrators: 3, refreshIntervalMs: 60_000, cacheAgeMs: 0 },
    });
  });

  it('returns a bare array of { address } in capability order, de-duplicated', async () => {
    const { GET } = await import('./route');
    const req = new NextRequest('http://localhost/api/v1/orchestrator-leaderboard/plans/plan-1/python-gateway', {
      headers: { Authorization: 'Bearer pmth_test' },
    });
    const res = await GET(req, { params: Promise.resolve({ id: 'plan-1' }) });

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    const body = (await res.json()) as { address: string }[];
    expect(Array.isArray(body)).toBe(true);
    expect(body).toEqual([
      { address: 'https://dup.test' },
      { address: 'https://orch-b.test' },
      { address: 'https://orch-a.test' },
    ]);
  });

  it('returns 401 when unauthenticated', async () => {
    (authorize as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const { GET } = await import('./route');
    const req = new NextRequest('http://localhost/api/v1/orchestrator-leaderboard/plans/plan-1/python-gateway');
    const res = await GET(req, { params: Promise.resolve({ id: 'plan-1' }) });
    expect(res.status).toBe(401);
  });
});
