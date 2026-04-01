import { NextRequest, NextResponse } from 'next/server';
import { getPerfByModel } from '@/lib/facade';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(request: NextRequest): Promise<NextResponse> {
  const params = request.nextUrl.searchParams;
  const start = params.get('start')?.trim() ?? '';
  const end = params.get('end')?.trim() ?? '';

  if (!start || !end) {
    return NextResponse.json(
      { error: { code: 'BAD_REQUEST', message: 'Both start and end query params are required.' } },
      { status: 400 },
    );
  }

  try {
    const fpsByPipelineModel = await getPerfByModel({ start, end });
    return NextResponse.json({ fpsByPipelineModel });
  } catch (err) {
    console.error('[network/perf-by-model] error:', err);
    return NextResponse.json(
      { error: { code: 'SERVICE_UNAVAILABLE', message: 'Perf-by-model data is unavailable' } },
      { status: 503 },
    );
  }
}

