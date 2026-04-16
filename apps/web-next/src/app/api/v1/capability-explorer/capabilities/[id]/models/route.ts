export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { authorize } from '@/lib/gateway/authorize';
import { getAuthToken } from '@/lib/api/response';
import { handleGetCapabilityModels } from '@capability-explorer/backend';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await authorize(request);
  if (!auth) {
    return NextResponse.json(
      { success: false, error: { code: 'UNAUTHORIZED', message: 'Missing or invalid authentication' } },
      { status: 401 },
    );
  }
  const { id } = await params;
  const ctx = {
    authToken: getAuthToken(request) || '',
    requestUrl: request.url,
    cookieHeader: request.headers.get('cookie'),
  };
  const result = await handleGetCapabilityModels(id, ctx);
  const status = result.success ? 200 : result.error?.code === 'NOT_FOUND' ? 404 : 400;
  return NextResponse.json(result, { status });
}
