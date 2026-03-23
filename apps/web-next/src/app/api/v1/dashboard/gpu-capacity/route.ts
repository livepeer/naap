import { NextRequest, NextResponse } from 'next/server';
import { resolveGPUCapacity } from '@/lib/dashboard/resolvers';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(request: NextRequest): Promise<NextResponse> {
  const params = request.nextUrl.searchParams;
  const timeframeStr = params.get('timeframe') ?? undefined;
  const timeframe = timeframeStr != null ? parseInt(timeframeStr, 10) : undefined;

  try {
    const result = await resolveGPUCapacity({ timeframe });
    return NextResponse.json(result);
  } catch (err) {
    console.error('[dashboard/gpu-capacity] error:', err);
    return NextResponse.json(
      { error: { code: 'SERVICE_UNAVAILABLE', message: 'GPU capacity data is unavailable' } },
      { status: 503 }
    );
  }
}
