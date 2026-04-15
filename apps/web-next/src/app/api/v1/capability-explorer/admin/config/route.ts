/**
 * GET  /api/v1/capability-explorer/admin/config — current config
 * PATCH /api/v1/capability-explorer/admin/config — update refresh interval, toggle sources
 */

export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { authorize } from '@/lib/gateway/authorize';
import { handleGetConfig, handleUpdateConfig } from '@capability-explorer/backend';

export async function GET(request: NextRequest): Promise<NextResponse> {
  const auth = await authorize(request);
  if (!auth) {
    return NextResponse.json(
      { success: false, error: { code: 'UNAUTHORIZED', message: 'Missing or invalid authentication' } },
      { status: 401 },
    );
  }

  const result = await handleGetConfig();
  return NextResponse.json(result, { status: result.success ? 200 : 500 });
}

export async function PATCH(request: NextRequest): Promise<NextResponse> {
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

  const result = await handleUpdateConfig(body);
  return NextResponse.json(result, { status: result.success ? 200 : 400 });
}
