import { NextRequest, NextResponse } from 'next/server';
import { resolveRawNetworkDemand } from '@/lib/dashboard/resolvers';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(request: NextRequest): Promise<NextResponse> {
  const params = request.nextUrl.searchParams;

  const filters = {
    window: params.get('window') ?? undefined,
    gateway: params.get('gateway') ?? undefined,
    region: params.get('region') ?? undefined,
    pipelineId: params.get('pipelineId') ?? undefined,
    modelId: params.get('modelId') ?? undefined,
  };

  try {
    const result = await resolveRawNetworkDemand(filters);
    return NextResponse.json(result);
  } catch (err) {
    console.error('[dashboard/network-demand] error:', err);
    return NextResponse.json(
      { error: { code: 'SERVICE_UNAVAILABLE', message: 'Network demand data is unavailable' } },
      { status: 503 }
    );
  }
}
