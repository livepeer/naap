import { NextRequest, NextResponse } from 'next/server';
import { getDashboardPipelines } from '@/lib/facade';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(request: NextRequest): Promise<NextResponse> {
  const params = request.nextUrl.searchParams;
  const timeframe = params.get('timeframe') ?? undefined;
  const limitStr = params.get('limit');
  const limit = limitStr != null ? parseInt(limitStr, 10) : 5;

  try {
    const result = await getDashboardPipelines({ timeframe, limit });
    return NextResponse.json(result);
  } catch (err) {
    console.error('[dashboard/pipelines] error:', err);
    return NextResponse.json(
      { error: { code: 'SERVICE_UNAVAILABLE', message: 'Pipelines data is unavailable' } },
      { status: 503 }
    );
  }
}
