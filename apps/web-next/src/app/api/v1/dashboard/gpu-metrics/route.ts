import { NextRequest, NextResponse } from 'next/server';
import { resolveRawGPUMetrics } from '@/lib/dashboard/resolvers';

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
    gpuModelName: params.get('gpuModelName') ?? undefined,
    runnerVersion: params.get('runnerVersion') ?? undefined,
    cudaVersion: params.get('cudaVersion') ?? undefined,
  };

  try {
    const result = await resolveRawGPUMetrics(filters);
    return NextResponse.json(result);
  } catch (err) {
    console.error('[dashboard/gpu-metrics] error:', err);
    return NextResponse.json(
      { error: { code: 'SERVICE_UNAVAILABLE', message: 'GPU metrics data is unavailable' } },
      { status: 503 }
    );
  }
}
