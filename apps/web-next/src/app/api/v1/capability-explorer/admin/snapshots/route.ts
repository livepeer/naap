/**
 * GET /api/v1/capability-explorer/admin/snapshots — recent snapshot history
 */

export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { authorize } from '@/lib/gateway/authorize';
import { handleGetSnapshots } from '@capability-explorer/backend';

export async function GET(request: NextRequest): Promise<NextResponse> {
  const auth = await authorize(request);
  if (!auth) {
    return NextResponse.json(
      { success: false, error: { code: 'UNAUTHORIZED', message: 'Missing or invalid authentication' } },
      { status: 401 },
    );
  }

  const limit = Number(request.nextUrl.searchParams.get('limit')) || 20;
  const result = await handleGetSnapshots(limit);
  return NextResponse.json(result, { status: result.success ? 200 : 500 });
}
