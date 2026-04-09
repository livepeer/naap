/**
 * GET    /api/v1/orchestrator-leaderboard/plans/:id — get plan definition
 * PUT    /api/v1/orchestrator-leaderboard/plans/:id — update plan
 * DELETE /api/v1/orchestrator-leaderboard/plans/:id — delete plan
 */

export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { authorize } from '@/lib/gateway/authorize';
import { success, errors } from '@/lib/api/response';
import { getPlan, updatePlan, deletePlan } from '@/lib/orchestrator-leaderboard/plans';
import { UpdatePlanSchema } from '@/lib/orchestrator-leaderboard/types';
import { invalidatePlanCache } from '@/lib/orchestrator-leaderboard/refresh';

type RouteContext = { params: Promise<{ id: string }> };

function scopeFromAuth(auth: { teamId: string; callerId: string }) {
  return { teamId: auth.teamId, ownerUserId: auth.callerId };
}

export async function GET(
  request: NextRequest,
  context: RouteContext,
): Promise<NextResponse | Response> {
  const auth = await authorize(request);
  if (!auth) return errors.unauthorized('Missing or invalid authentication');

  const { id } = await context.params;
  const plan = await getPlan(id, scopeFromAuth(auth));
  if (!plan) return errors.notFound('Plan not found');

  return success({ plan });
}

export async function PUT(
  request: NextRequest,
  context: RouteContext,
): Promise<NextResponse | Response> {
  const auth = await authorize(request);
  if (!auth) return errors.unauthorized('Missing or invalid authentication');

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errors.badRequest('Invalid JSON body');
  }

  const parsed = UpdatePlanSchema.safeParse(body);
  if (!parsed.success) {
    return errors.badRequest(parsed.error.issues.map((i) => i.message).join('; '));
  }

  const { id } = await context.params;
  const plan = await updatePlan(id, parsed.data, scopeFromAuth(auth));
  if (!plan) return errors.notFound('Plan not found');

  invalidatePlanCache(id);
  return success({ plan });
}

export async function DELETE(
  request: NextRequest,
  context: RouteContext,
): Promise<NextResponse | Response> {
  const auth = await authorize(request);
  if (!auth) return errors.unauthorized('Missing or invalid authentication');

  const { id } = await context.params;
  const deleted = await deletePlan(id, scopeFromAuth(auth));
  if (!deleted) return errors.notFound('Plan not found');

  return NextResponse.json({ success: true }, { status: 200 });
}
