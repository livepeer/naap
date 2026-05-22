/**
 * GET    /api/v1/orchestrator-leaderboard/plans/:id — get plan definition
 * PUT    /api/v1/orchestrator-leaderboard/plans/:id — update plan
 * DELETE /api/v1/orchestrator-leaderboard/plans/:id — delete plan
 *
 * Public plans (admin defaults) are read-only for non-admins.
 */

export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { authorize } from '@/lib/gateway/authorize';
import { validateSession } from '@/lib/api/auth';
import { success, errors, getAuthToken } from '@/lib/api/response';
import { getPlan, updatePlan, deletePlan } from '@/lib/orchestrator-leaderboard/plans';
import type { PlanScope } from '@/lib/orchestrator-leaderboard/plans';
import { UpdatePlanSchema } from '@/lib/orchestrator-leaderboard/types';
import { invalidatePlanCache } from '@/lib/orchestrator-leaderboard/refresh';

type RouteContext = { params: Promise<{ id: string }> };

async function scopeFromAuth(
  request: NextRequest,
  auth: { teamId: string; callerId: string },
): Promise<PlanScope> {
  const scope: PlanScope = { teamId: auth.teamId, ownerUserId: auth.callerId };
  const token = getAuthToken(request);
  if (token) {
    const user = await validateSession(token);
    if (user?.roles.includes('system:admin')) scope.isAdmin = true;
  }
  return scope;
}

export async function GET(
  request: NextRequest,
  context: RouteContext,
): Promise<NextResponse | Response> {
  const auth = await authorize(request);
  if (!auth) return errors.unauthorized('Missing or invalid authentication');

  const scope: PlanScope = { teamId: auth.teamId, ownerUserId: auth.callerId };
  const { id } = await context.params;
  const plan = await getPlan(id, scope);
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

  const scope = await scopeFromAuth(request, auth);
  const { id } = await context.params;
  const plan = await updatePlan(id, parsed.data, scope);
  if (plan === 'forbidden') {
    return errors.forbidden('Only admins can modify public plans');
  }
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

  const scope = await scopeFromAuth(request, auth);
  const { id } = await context.params;
  const deleted = await deletePlan(id, scope);
  if (deleted === 'forbidden') {
    return errors.forbidden('Only admins can delete public plans');
  }
  if (!deleted) return errors.notFound('Plan not found');

  return NextResponse.json({ success: true }, { status: 200 });
}
