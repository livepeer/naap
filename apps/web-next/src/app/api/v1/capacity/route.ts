import { NextResponse } from 'next/server';
import { fetchGPUCapacityFromClickHouse } from '@/lib/dashboard/gpu-capacity-clickhouse';
import type { CapacitySummary, PipelineGPUBreakdown } from '@/lib/api/types/public-api';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(): Promise<NextResponse> {
  try {
    const cap = await fetchGPUCapacityFromClickHouse();

    const pipelines: PipelineGPUBreakdown[] = (cap.pipelineGPUs ?? []).map((p) => ({
      pipeline: p.name,
      gpu_count: p.gpus,
      by_model: (p.models ?? []).map((m) => ({
        model: m.model,
        gpu_count: m.gpus,
      })),
    }));

    const body: CapacitySummary = {
      total_gpus: cap.totalGPUs,
      pipelines,
    };

    return NextResponse.json(body);
  } catch (err) {
    console.error('[api/v1/capacity] error:', err);
    return NextResponse.json(
      { error: { code: 'SERVICE_UNAVAILABLE', message: 'Capacity data is unavailable' } },
      { status: 503 },
    );
  }
}
