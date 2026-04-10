/**
 * POST /api/v1/orchestrator-leaderboard/plans/seed
 *
 * Inserts 4 diverse demo plans for the authenticated caller.
 * Only available in development (NODE_ENV !== 'production').
 */

export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { authorize } from '@/lib/gateway/authorize';
import { errors } from '@/lib/api/response';
import { createPlan, listPlans } from '@/lib/orchestrator-leaderboard/plans';
import type { CreatePlanInput } from '@/lib/orchestrator-leaderboard/types';

const DEMO_PLANS: CreatePlanInput[] = [
  {
    billingPlanId: 'demo-high-perf-video',
    name: 'High-Performance Video',
    capabilities: ['image-to-video'],
    topN: 10,
    slaWeights: { latency: 0.6, swapRate: 0.2, price: 0.2 },
    slaMinScore: 0.7,
    sortBy: 'latency',
    filters: { maxAvgLatencyMs: 500 },
  },
  {
    billingPlanId: 'demo-budget-image',
    name: 'Budget Image Generation',
    capabilities: ['image-to-image', 'text-to-image'],
    topN: 20,
    slaWeights: { latency: 0.2, swapRate: 0.2, price: 0.6 },
    slaMinScore: 0.3,
    sortBy: 'price',
  },
  {
    billingPlanId: 'demo-balanced-stream',
    name: 'Balanced Streaming',
    capabilities: ['streamdiffusion', 'streamdiffusion-sdxl'],
    topN: 15,
    slaWeights: { latency: 0.34, swapRate: 0.33, price: 0.33 },
    slaMinScore: 0.5,
    sortBy: 'slaScore',
  },
  {
    billingPlanId: 'demo-max-avail',
    name: 'Maximum Availability',
    capabilities: ['noop', 'streamdiffusion', 'streamdiffusion-sdxl', 'streamdiffusion-sdxl-v2v'],
    topN: 50,
    sortBy: 'avail',
  },
];

function scopeFromAuth(auth: { teamId: string; callerId: string }) {
  return { teamId: auth.teamId, ownerUserId: auth.callerId };
}

export async function POST(request: NextRequest): Promise<NextResponse | Response> {
  if (process.env.NODE_ENV === 'production') {
    return errors.badRequest('Seed route is only available in development');
  }

  const auth = await authorize(request);
  if (!auth) {
    return errors.unauthorized('Missing or invalid authentication');
  }

  const scope = scopeFromAuth(auth);
  const existing = await listPlans(scope);
  const existingIds = new Set(existing.map((p) => p.billingPlanId));

  let created = 0;
  for (const demo of DEMO_PLANS) {
    if (existingIds.has(demo.billingPlanId)) continue;
    try {
      await createPlan(demo, scope);
      created++;
    } catch {
      // skip duplicates
    }
  }

  return NextResponse.json({
    success: true,
    data: { created, total: existing.length + created },
  });
}
