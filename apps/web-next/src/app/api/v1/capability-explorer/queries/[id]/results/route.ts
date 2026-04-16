/**
 * GET /api/v1/capability-explorer/queries/:id/results — evaluate query against warm cache
 *
 * This is the stable endpoint users poll. Configure the query once, then
 * GET this URL repeatedly to get filtered capabilities.
 */

export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { authorize } from '@/lib/gateway/authorize';
import { handleGetQueryResults } from '@capability-explorer/backend';

function scopeFromAuth(auth: { teamId: string; callerId: string }) {
  return { teamId: auth.teamId, ownerUserId: auth.callerId };
}

type RouteParams = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: RouteParams): Promise<NextResponse | Response> {
  const auth = await authorize(request);
  if (!auth) {
    return NextResponse.json(
      { success: false, error: { code: 'UNAUTHORIZED', message: 'Missing or invalid authentication' } },
      { status: 401 },
    );
  }

  const { id } = await params;
  const result = await handleGetQueryResults(id, scopeFromAuth(auth));
  const status = result.success ? 200 : result.error?.code === 'NOT_FOUND' ? 404 : 500;
  return NextResponse.json(result, { status });
}
