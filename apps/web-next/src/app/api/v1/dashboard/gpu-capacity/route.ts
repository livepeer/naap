import { NextRequest, NextResponse } from 'next/server';
import { getDashboardGPUCapacity } from '@/lib/facade';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(request: NextRequest): Promise<NextResponse> {
  const params = request.nextUrl.searchParams;
  const timeframe = params.get('timeframe') ?? undefined;

  try {
    const result = await getDashboardGPUCapacity({ timeframe });
    return NextResponse.json(result);
  } catch (err) {
    console.error('[dashboard/gpu-capacity] error:', err);
    return NextResponse.json(
      { error: { code: 'SERVICE_UNAVAILABLE', message: 'GPU capacity data is unavailable' } },
      { status: 503 }
    );
  }
}
