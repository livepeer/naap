export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { authorize } from '@/lib/gateway/authorize';
import { getAuthToken } from '@/lib/api/response';
import { handleGraphQL } from '@capability-explorer/backend';

export async function POST(request: NextRequest): Promise<NextResponse> {
  const auth = await authorize(request);
  if (!auth) {
    return NextResponse.json(
      { success: false, error: { code: 'UNAUTHORIZED', message: 'Missing or invalid authentication' } },
      { status: 401 },
    );
  }

  let body: { query: string; variables?: Record<string, unknown> };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid JSON body' } },
      { status: 400 },
    );
  }

  const ctx = {
    authToken: getAuthToken(request) || '',
    requestUrl: request.url,
    cookieHeader: request.headers.get('cookie'),
  };
  const result = await handleGraphQL(body, ctx);
  return NextResponse.json(result);
}
