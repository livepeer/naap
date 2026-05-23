/**
 * GET  /api/v1/orchestrator-leaderboard/plans  — list caller's plans + public plans
 * POST /api/v1/orchestrator-leaderboard/plans  — create a personal discovery plan
 */

export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { authorize } from '@/lib/gateway/authorize';
import { success, errors } from '@/lib/api/response';
import { createPlan, listPlans } from '@/lib/orchestrator-leaderboard/plans';
import {
  BillingProviderSlugSchema,
  CreatePlanSchema,
} from '@/lib/orchestrator-leaderboard/types';

function scopeFromAuth(auth: { teamId: string; callerId: string }) {
  return { teamId: auth.teamId, ownerUserId: auth.callerId };
}

function parseBillingProviderSlugParam(
  request: NextRequest,
): { value: string | null; error: string | null } {
  const raw = request.nextUrl.searchParams.get('billingProviderSlug');
  if (raw === null) {
    return { value: null, error: null };
  }
  const parsed = BillingProviderSlugSchema.safeParse(raw.trim().toLowerCase());
  if (!parsed.success) {
    return { value: null, error: 'Invalid billingProviderSlug' };
  }
  return { value: parsed.data, error: null };
}

export async function GET(request: NextRequest): Promise<NextResponse | Response> {
  const auth = await authorize(request);
  if (!auth) {
    return errors.unauthorized('Missing or invalid authentication');
  }

  const parsedSlug = parseBillingProviderSlugParam(request);
  if (parsedSlug.error) {
    return errors.badRequest(parsedSlug.error);
  }

  const plans = await listPlans(scopeFromAuth(auth), parsedSlug.value);
  return success({ plans });
}

export async function POST(request: NextRequest): Promise<NextResponse | Response> {
  const auth = await authorize(request);
  if (!auth) {
    return errors.unauthorized('Missing or invalid authentication');
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errors.badRequest('Invalid JSON body');
  }

  const parsed = CreatePlanSchema.safeParse(body);
  if (!parsed.success) {
    return errors.badRequest(parsed.error.issues.map((i) => i.message).join('; '));
  }

  try {
    const plan = await createPlan(parsed.data, scopeFromAuth(auth));
    return NextResponse.json({ success: true, data: plan }, { status: 201 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to create plan';
    if (msg.includes('Unique constraint')) {
      return errors.badRequest('A plan with this billingPlanId already exists');
    }
    return errors.internal(msg);
  }
}
