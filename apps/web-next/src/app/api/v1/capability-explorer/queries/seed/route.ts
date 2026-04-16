/**
 * POST /api/v1/capability-explorer/queries/seed — seed 4 demo queries for caller
 */

export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { authorize } from '@/lib/gateway/authorize';
import { handleSeedQueries } from '@capability-explorer/backend';

function scopeFromAuth(auth: { teamId: string; callerId: string }) {
  return { teamId: auth.teamId, ownerUserId: auth.callerId };
}

export async function POST(request: NextRequest): Promise<NextResponse | Response> {
  const auth = await authorize(request);
  if (!auth) {
    return NextResponse.json(
      { success: false, error: { code: 'UNAUTHORIZED', message: 'Missing or invalid authentication' } },
      { status: 401 },
    );
  }

  const result = await handleSeedQueries(scopeFromAuth(auth));
  return NextResponse.json(result, { status: result.success ? 200 : 500 });
}
