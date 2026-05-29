/**
 * Regression tests for GET /api/v1/orchestrator-leaderboard/plans/:id/results.
 *
 * Key contract: the response shape is single-wrapped — body.data is PlanResults
 * directly; there is NO body.data.data nesting.
 */

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

import { authorize } from '@/lib/gateway/authorize';
import { getPlan } from '@/lib/orchestrator-leaderboard/plans';
import { evaluateAndCache } from '@/lib/orchestrator-leaderboard/refresh';
import { GET } from './route';

const MOCK_AUTH = {
  authenticated: true,
  teamId: 'personal:user-1',
  callerType: 'jwt',
  callerId: 'user-1',
};

const MOCK_PLAN = {
  id: 'plan-1',
  billingPlanId: 'bp-1',
  billingProviderSlug: 'daydream',
  name: 'Test Plan',
  description: 'desc',
  teamId: null,
  ownerUserId: 'user-1',
  capabilities: ['image-to-video'],
  topN: 10,
  slaWeights: null,
  slaMinScore: null,
  sortBy: null,
  filters: null,
  enabled: true,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const MOCK_RESULTS = {
  planId: 'plan-1',
  refreshedAt: new Date().toISOString(),
  capabilities: {
    'image-to-video': [
      {
        orchUri: 'https://orch-a.test',
        gpuName: 'A100',
        gpuGb: 80,
        avail: 1,
        totalCap: 5,
        pricePerUnit: 0.01,
        bestLatMs: 120,
        avgLatMs: 150,
        swapRatio: 0.02,
        avgAvail: 0.99,
      },
    ],
  },
  meta: {
    cacheAgeMs: 0,
    refreshIntervalMs: 3_600_000,
  },
};

function makeRequest(planId: string, searchParams = '') {
  return new NextRequest(
    `http://localhost/api/v1/orchestrator-leaderboard/plans/${planId}/results${searchParams}`,
  );
}

function makeContext(planId: string) {
  return { params: Promise.resolve({ id: planId }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  (authorize as ReturnType<typeof vi.fn>).mockResolvedValue(MOCK_AUTH);
  (getPlan as ReturnType<typeof vi.fn>).mockResolvedValue(MOCK_PLAN);
  (evaluateAndCache as ReturnType<typeof vi.fn>).mockResolvedValue(MOCK_RESULTS);
});

describe('GET /api/v1/orchestrator-leaderboard/plans/:id/results', () => {
  it('returns 200 with single-wrapped PlanResults — body.data.capabilities is defined', async () => {
    const res = await GET(makeRequest('plan-1'), makeContext('plan-1'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);

    // Single-wrap: body.data IS the PlanResults object.
    expect(body.data).toBeDefined();
    expect(body.data.capabilities).toBeDefined();
    expect(body.data.capabilities['image-to-video']).toHaveLength(1);
    expect(body.data.capabilities['image-to-video'][0].orchUri).toBe('https://orch-a.test');

    // Regression: there must be NO double-nesting.
    expect(body.data.data).toBeUndefined();
  });

  it('includes plan metadata in the response data', async () => {
    const res = await GET(makeRequest('plan-1'), makeContext('plan-1'));
    const body = await res.json();

    expect(body.data.plan).toBeDefined();
    expect(body.data.plan.name).toBe('Test Plan');
    expect(body.data.plan.capabilities).toContain('image-to-video');
  });

  it('returns 401 when not authenticated', async () => {
    (authorize as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const res = await GET(makeRequest('plan-1'), makeContext('plan-1'));
    expect(res.status).toBe(401);
  });

  it('returns 404 when plan does not exist', async () => {
    (getPlan as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const res = await GET(makeRequest('plan-1'), makeContext('plan-1'));
    expect(res.status).toBe(404);
  });

  it('returns 400 when plan is disabled', async () => {
    (getPlan as ReturnType<typeof vi.fn>).mockResolvedValue({ ...MOCK_PLAN, enabled: false });
    const res = await GET(makeRequest('plan-1'), makeContext('plan-1'));
    expect(res.status).toBe(400);
  });

  it('returns 400 for an empty billingProviderSlug param', async () => {
    const res = await GET(
      makeRequest('plan-1', '?billingProviderSlug='),
      makeContext('plan-1'),
    );
    expect(res.status).toBe(400);
  });

  it('returns 400 for a blank billingProviderSlug param', async () => {
    const res = await GET(
      makeRequest('plan-1', '?billingProviderSlug=%20'),
      makeContext('plan-1'),
    );
    expect(res.status).toBe(400);
  });
});
