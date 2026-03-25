import { NextRequest, NextResponse } from 'next/server';
import { resolveOrchestrators } from '@/lib/dashboard/resolvers';
import type { OrchestratorSummary } from '@/lib/api/types/public-api';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(request: NextRequest): Promise<NextResponse> {
  const period = request.nextUrl.searchParams.get('period') ?? '24h';

  try {
    const orchestrators = await resolveOrchestrators({ period });

    const body: OrchestratorSummary[] = orchestrators.map((o) => ({
      address: o.address,
      success_rate: o.successRatio,
      sla_score: o.slaScore,
      gpu_count: o.gpuCount,
      pipelines: o.pipelines,
      sessions: o.knownSessions,
    }));

    return NextResponse.json(body);
  } catch (err) {
    console.error('[api/v1/orchestrators] error:', err);
    return NextResponse.json(
      { error: { code: 'SERVICE_UNAVAILABLE', message: 'Orchestrators data is unavailable' } },
      { status: 503 },
    );
  }
}
