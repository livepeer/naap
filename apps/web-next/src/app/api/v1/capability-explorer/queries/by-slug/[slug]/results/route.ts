/**
 * GET /api/v1/capability-explorer/queries/by-slug/:slug/results
 *
 * Same as /queries/:id/results but uses the human-readable slug
 * instead of the opaque cuid. Slug uniqueness is per ownerUserId.
 */

export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { authorize } from '@/lib/gateway/authorize';
import { handleGetQueryResultsBySlug } from '@capability-explorer/backend';

function scopeFromAuth(auth: { teamId: string; callerId: string }) {
  return { teamId: auth.teamId, ownerUserId: auth.callerId };
}

type RouteParams = { params: Promise<{ slug: string }> };

export async function GET(request: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  const auth = await authorize(request);
  if (!auth) {
    return NextResponse.json(
      { success: false, error: { code: 'UNAUTHORIZED', message: 'Missing or invalid authentication' } },
      { status: 401 },
    );
  }

  const { slug } = await params;
  const result = await handleGetQueryResultsBySlug(slug, scopeFromAuth(auth));
  const status = result.success ? 200 : result.error?.code === 'NOT_FOUND' ? 404 : 500;
  return NextResponse.json(result, { status });
}
