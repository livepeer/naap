/**
 * GET    /api/v1/capability-explorer/queries/:id — get one query
 * PUT    /api/v1/capability-explorer/queries/:id — update
 * DELETE /api/v1/capability-explorer/queries/:id — delete
 */

export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { authorize } from '@/lib/gateway/authorize';
import { handleGetQuery, handleUpdateQuery, handleDeleteQuery } from '@capability-explorer/backend';

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
  const result = await handleGetQuery(id, scopeFromAuth(auth));
  const status = result.success ? 200 : result.error?.code === 'NOT_FOUND' ? 404 : 500;
  return NextResponse.json(result, { status });
}

export async function PUT(request: NextRequest, { params }: RouteParams): Promise<NextResponse | Response> {
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

  const { id } = await params;
  const result = await handleUpdateQuery(id, body, scopeFromAuth(auth));
  const status = result.success ? 200 : result.error?.code === 'NOT_FOUND' ? 404 : 400;
  return NextResponse.json(result, { status });
}

export async function DELETE(request: NextRequest, { params }: RouteParams): Promise<NextResponse | Response> {
  const auth = await authorize(request);
  if (!auth) {
    return NextResponse.json(
      { success: false, error: { code: 'UNAUTHORIZED', message: 'Missing or invalid authentication' } },
      { status: 401 },
    );
  }

  const { id } = await params;
  const result = await handleDeleteQuery(id, scopeFromAuth(auth));
  const status = result.success ? 200 : result.error?.code === 'NOT_FOUND' ? 404 : 500;
  return NextResponse.json(result, { status });
}
