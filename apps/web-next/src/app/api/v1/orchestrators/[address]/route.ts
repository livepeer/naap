import { NextRequest, NextResponse } from 'next/server';
import { resolveOrchestrators } from '@/lib/dashboard/resolvers';
import type { OrchestratorDetail } from '@/lib/api/types/public-api';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ address: string }> },
): Promise<NextResponse> {
  const { address } = await params;
  const period = request.nextUrl.searchParams.get('period') ?? '24h';

  try {
    const orchestrators = await resolveOrchestrators({ period });
    const match = orchestrators.find(
      (o) => o.address.toLowerCase() === address.toLowerCase(),
    );

    if (!match) {
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: `Orchestrator ${address} not found` } },
        { status: 404 },
      );
    }

    const body: OrchestratorDetail = {
      address: match.address,
      success_rate: match.successRatio,
      sla_score: match.slaScore,
      gpu_count: match.gpuCount,
      sessions: match.knownSessions,
      pipelines: match.pipelines,
      pipeline_models: match.pipelineModels.map((pm) => ({
        pipeline: pm.pipelineId,
        models: pm.modelIds,
      })),
    };

    return NextResponse.json(body);
  } catch (err) {
    console.error('[api/v1/orchestrators/[address]] error:', err);
    return NextResponse.json(
      { error: { code: 'SERVICE_UNAVAILABLE', message: 'Orchestrator data is unavailable' } },
      { status: 503 },
    );
  }
}
