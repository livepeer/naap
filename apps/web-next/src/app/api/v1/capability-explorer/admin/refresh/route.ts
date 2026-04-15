/**
 * POST /api/v1/capability-explorer/admin/refresh — manual trigger (admin auth)
 */

export const runtime = 'nodejs';
export const maxDuration = 120;

import { NextRequest, NextResponse } from 'next/server';
import { authorize } from '@/lib/gateway/authorize';
import { getAuthToken } from '@/lib/api/response';
import { handleAdminRefresh } from '@capability-explorer/backend';

export async function POST(request: NextRequest): Promise<NextResponse> {
  const auth = await authorize(request);
  if (!auth) {
    return NextResponse.json(
      { success: false, error: { code: 'UNAUTHORIZED', message: 'Missing or invalid authentication' } },
      { status: 401 },
    );
  }

  const ctx = {
    authToken: getAuthToken(request) || '',
    requestUrl: request.url,
    cookieHeader: request.headers.get('cookie'),
  };

  const result = await handleAdminRefresh(ctx);
  return NextResponse.json(result, { status: result.success ? 200 : 500 });
}
