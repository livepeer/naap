import { NextRequest, NextResponse } from 'next/server';
import { getNetworkModels } from '@/lib/facade';

export const runtime = 'nodejs';
export const maxDuration = 30;

export async function GET(request: NextRequest): Promise<NextResponse> {
  const params = request.nextUrl.searchParams;
  const limitStr = params.get('limit');
  const parsed = limitStr != null ? parseInt(limitStr, 10) : NaN;
  const limit = Number.isFinite(parsed) && parsed >= 1
    ? Math.min(parsed, 200)
    : 50;

  try {
    const { models, total } = await getNetworkModels({ limit });
    return NextResponse.json({
      models,
      count: models.length,
      total,
    });
  } catch (err) {
    console.error('[network/models] error:', err);
    return NextResponse.json(
      { error: { code: 'SERVICE_UNAVAILABLE', message: 'Network models data is unavailable' } },
      { status: 503 }
    );
  }
}
