/**
 * GET /api/v1/orchestrator-leaderboard/plans/:id/results
 *
 * Returns the latest evaluated results for a discovery plan.
 * Uses lazy evaluation: if cached and fresh, returns immediately;
 * otherwise evaluates the plan on demand and caches the result.
 */

export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { authorize } from '@/lib/gateway/authorize';
import { success, errors } from '@/lib/api/response';
import { getAuthToken } from '@/lib/api/response';
import { getPlan } from '@/lib/orchestrator-leaderboard/plans';
import { evaluateAndCache } from '@/lib/orchestrator-leaderboard/refresh';
import { BillingProviderSlugSchema } from '@/lib/orchestrator-leaderboard/types';

type RouteContext = { params: Promise<{ id: string }> };

function scopeFromAuth(auth: { teamId: string; callerId: string }) {
  return { teamId: auth.teamId, ownerUserId: auth.callerId };
}

function parseBillingProviderSlugParam(
  request: NextRequest,
): { value: string | null; error: string | null } {
  const raw = request.nextUrl.searchParams.get('billingProviderSlug');
  if (!raw) {
    return { value: null, error: null };
  }
  const parsed = BillingProviderSlugSchema.safeParse(raw.trim().toLowerCase());
  if (!parsed.success) {
    return { value: null, error: 'Invalid billingProviderSlug' };
  }
  return { value: parsed.data, error: null };
}

export async function GET(
  request: NextRequest,
  context: RouteContext,
): Promise<NextResponse | Response> {
  const auth = await authorize(request);
  if (!auth) return errors.unauthorized('Missing or invalid authentication');
  const parsedSlug = parseBillingProviderSlugParam(request);
  if (parsedSlug.error) return errors.badRequest(parsedSlug.error);

  const { id } = await context.params;
  const plan = await getPlan(id, scopeFromAuth(auth), parsedSlug.value);
  if (!plan) return errors.notFound('Plan not found');

  if (!plan.enabled) {
    return errors.badRequest('Plan is disabled');
  }

  const authToken = getAuthToken(request) || '';

  try {
    const results = await evaluateAndCache(
      plan,
      authToken,
      request.url,
      request.headers.get('cookie'),
    );

    const withPlanMeta = {
      ...results,
      plan: {
        name: plan.name,
        description: plan.description,
        capabilities: plan.capabilities,
        topN: plan.topN,
      },
    };

    const response = success({ data: withPlanMeta });
    response.headers.set('Cache-Control', 'private, max-age=10');
    response.headers.set('X-Cache-Age', String(results.meta.cacheAgeMs));
    response.headers.set('X-Refresh-Interval', String(results.meta.refreshIntervalMs));
    return response;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to evaluate plan';
    return errors.internal(message);
  }
}
