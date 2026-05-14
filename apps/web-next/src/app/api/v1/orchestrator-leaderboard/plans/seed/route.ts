/**
 * POST /api/v1/orchestrator-leaderboard/plans/seed
 *
 * Inserts 4 diverse demo plans for the authenticated caller.
 * Each user gets their own set of plans (billingPlanId is scoped per user).
 * Idempotent — skips plans that already exist for the caller.
 */

export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { authorize } from '@/lib/gateway/authorize';
import { errors } from '@/lib/api/response';
import { createPlan, listPlans } from '@/lib/orchestrator-leaderboard/plans';
import type { CreatePlanInput } from '@/lib/orchestrator-leaderboard/types';

interface DemoPlanTemplate {
  slug: string;
  name: string;
  capabilities: string[];
  topN: number;
  slaWeights?: { latency: number; swapRate: number; price: number };
  slaMinScore?: number;
  sortBy?: string;
  filters?: { maxAvgLatencyMs?: number };
}

const DEMO_PLAN_TEMPLATES: DemoPlanTemplate[] = [
  {
    slug: 'high-perf-video',
    name: 'High-Performance Video',
    capabilities: ['image-to-video'],
    topN: 10,
    slaWeights: { latency: 0.6, swapRate: 0.2, price: 0.2 },
    slaMinScore: 0.7,
    sortBy: 'latency',
    filters: { maxAvgLatencyMs: 500 },
  },
  {
    slug: 'budget-image',
    name: 'Budget Image Generation',
    capabilities: ['image-to-image', 'text-to-image'],
    topN: 20,
    slaWeights: { latency: 0.2, swapRate: 0.2, price: 0.6 },
    slaMinScore: 0.3,
    sortBy: 'price',
  },
  {
    slug: 'balanced-stream',
    name: 'Balanced Streaming',
    capabilities: ['streamdiffusion', 'streamdiffusion-sdxl'],
    topN: 15,
    slaWeights: { latency: 0.34, swapRate: 0.33, price: 0.33 },
    slaMinScore: 0.5,
    sortBy: 'slaScore',
  },
  {
    slug: 'max-avail',
    name: 'Maximum Availability',
    capabilities: ['noop', 'streamdiffusion', 'streamdiffusion-sdxl', 'streamdiffusion-sdxl-v2v'],
    topN: 50,
    sortBy: 'avail',
  },
];

function scopeFromAuth(auth: { teamId: string; callerId: string }) {
  return { teamId: auth.teamId, ownerUserId: auth.callerId };
}

function userPlanId(userId: string, slug: string): string {
  return `demo-${userId.slice(0, 8)}-${slug}`;
}

export async function POST(request: NextRequest): Promise<NextResponse | Response> {
  const auth = await authorize(request);
  if (!auth) {
    return errors.unauthorized('Missing or invalid authentication');
  }

  const scope = scopeFromAuth(auth);
  const existing = await listPlans(scope);
  const existingIds = new Set(existing.map((p) => p.billingPlanId));

  let created = 0;
  for (const tpl of DEMO_PLAN_TEMPLATES) {
    const billingPlanId = userPlanId(auth.callerId, tpl.slug);
    if (existingIds.has(billingPlanId)) continue;

    const input: CreatePlanInput = {
      billingPlanId,
      name: tpl.name,
      capabilities: tpl.capabilities,
      topN: tpl.topN,
      slaWeights: tpl.slaWeights,
      slaMinScore: tpl.slaMinScore,
      sortBy: tpl.sortBy,
      filters: tpl.filters,
    };

    try {
      await createPlan(input, scope);
      created++;
    } catch {
      // skip duplicates (race or constraint)
    }
  }

  return NextResponse.json({
    success: true,
    data: { created, total: existing.length + created },
  });
}
