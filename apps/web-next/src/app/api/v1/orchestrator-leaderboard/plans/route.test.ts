import { NextRequest } from 'next/server';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/gateway/authorize', () => ({
  authorize: vi.fn(),
}));

vi.mock('@/lib/orchestrator-leaderboard/plans', () => ({
  createPlan: vi.fn(),
  listPlans: vi.fn(),
}));

vi.mock('@/lib/orchestrator-leaderboard/refresh', () => ({
  warmDiscoveryPlanFailOpen: vi.fn().mockResolvedValue(undefined),
}));

import { authorize } from '@/lib/gateway/authorize';
import { createPlan } from '@/lib/orchestrator-leaderboard/plans';
import { warmDiscoveryPlanFailOpen } from '@/lib/orchestrator-leaderboard/refresh';

const createdPlan = {
  id: 'plan-new',
  billingPlanId: 'bp-new',
  billingProviderSlug: 'pymthouse' as const,
  name: 'New Plan',
  description: null,
  visibility: 'personal' as const,
  teamId: 'personal:user-1',
  ownerUserId: 'user-1',
  capabilities: ['streamdiffusion-sdxl'],
  topN: 10,
  slaWeights: null,
  slaMinScore: null,
  sortBy: null,
  filters: null,
  enabled: true,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

describe('POST /api/v1/orchestrator-leaderboard/plans', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (authorize as ReturnType<typeof vi.fn>).mockResolvedValue({
      authenticated: true,
      teamId: 'personal:user-1',
      callerType: 'jwt',
      callerId: 'user-1',
    });
    (createPlan as ReturnType<typeof vi.fn>).mockResolvedValue(createdPlan);
  });

  it('warms discovery immediately after create', async () => {
    const { POST } = await import('./route');
    const req = new NextRequest('http://localhost/api/v1/orchestrator-leaderboard/plans', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        billingPlanId: 'bp-new',
        name: 'New Plan',
        capabilities: ['streamdiffusion-sdxl'],
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(201);
    expect(warmDiscoveryPlanFailOpen).toHaveBeenCalledWith(createdPlan, 'createPlan');
  });
});
