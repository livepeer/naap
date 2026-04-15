/**
 * GET  /api/v1/capability-explorer/queries — list caller's saved queries
 * POST /api/v1/capability-explorer/queries — create a saved query
 */

export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { authorize } from '@/lib/gateway/authorize';
import { handleListQueries } from '@capability-explorer/backend';
import { handleCreateQuery } from '@capability-explorer/backend';

function scopeFromAuth(auth: { teamId: string; callerId: string }) {
  return { teamId: auth.teamId, ownerUserId: auth.callerId };
}

export async function GET(request: NextRequest): Promise<NextResponse | Response> {
  const auth = await authorize(request);
  if (!auth) {
    return NextResponse.json(
      { success: false, error: { code: 'UNAUTHORIZED', message: 'Missing or invalid authentication' } },
      { status: 401 },
    );
  }

  const result = await handleListQueries(scopeFromAuth(auth));
  return NextResponse.json(result, { status: result.success ? 200 : 500 });
}

export async function POST(request: NextRequest): Promise<NextResponse | Response> {
  const auth = await authorize(request);
  if (!auth) {
    return NextResponse.json(
      { success: false, error: { code: 'UNAUTHORIZED', message: 'Missing or invalid authentication' } },
      { status: 401 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: { code: 'BAD_REQUEST', message: 'Invalid JSON body' } },
      { status: 400 },
    );
  }

  const result = await handleCreateQuery(body, scopeFromAuth(auth));
  const status = result.success
    ? 201
    : result.error?.code === 'CONFLICT'
      ? 409
      : result.error?.code === 'VALIDATION_ERROR'
        ? 400
        : 500;
  return NextResponse.json(result, { status });
}
