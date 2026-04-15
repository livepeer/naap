/**
 * GET /api/v1/capability-explorer/admin/sources — list registered sources with status
 */

export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { authorize } from '@/lib/gateway/authorize';
import { handleGetSources } from '@capability-explorer/backend';

export async function GET(request: NextRequest): Promise<NextResponse> {
  const auth = await authorize(request);
  if (!auth) {
    return NextResponse.json(
      { success: false, error: { code: 'UNAUTHORIZED', message: 'Missing or invalid authentication' } },
      { status: 401 },
    );
  }

  const result = await handleGetSources();
  return NextResponse.json(result, { status: result.success ? 200 : 500 });
}
