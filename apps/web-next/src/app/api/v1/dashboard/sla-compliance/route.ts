import { NextRequest, NextResponse } from 'next/server';
import { resolveRawSLACompliance } from '@/lib/dashboard/resolvers';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(request: NextRequest): Promise<NextResponse> {
  const params = request.nextUrl.searchParams;

  const filters = {
    window: params.get('window') ?? undefined,
    orchestratorAddress: params.get('orchestratorAddress') ?? undefined,
    pipelineId: params.get('pipelineId') ?? undefined,
    modelId: params.get('modelId') ?? undefined,
    gpuId: params.get('gpuId') ?? undefined,
    region: params.get('region') ?? undefined,
  };

  try {
    const result = await resolveRawSLACompliance(filters);
    return NextResponse.json(result);
  } catch (err) {
    console.error('[dashboard/sla-compliance] error:', err);
    return NextResponse.json(
      { error: { code: 'SERVICE_UNAVAILABLE', message: 'SLA compliance data is unavailable' } },
      { status: 503 }
    );
  }
}
