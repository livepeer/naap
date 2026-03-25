import { NextResponse } from 'next/server';
import { fetchGPUCapacityFromClickHouse } from '@/lib/dashboard/gpu-capacity-clickhouse';
import type { GPUSummary, PipelineGPUBreakdown } from '@/lib/api/types/public-api';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(): Promise<NextResponse> {
  try {
    const cap = await fetchGPUCapacityFromClickHouse();

    const by_pipeline: PipelineGPUBreakdown[] = (cap.pipelineGPUs ?? []).map((p) => ({
      pipeline: p.name,
      gpu_count: p.gpus,
      by_model: (p.models ?? []).map((m) => ({
        model: m.model,
        gpu_count: m.gpus,
      })),
    }));

    const body: GPUSummary = {
      total: cap.totalGPUs,
      hardware: cap.models.map((m) => ({ model: m.model, count: m.count })),
      by_pipeline,
    };

    return NextResponse.json(body);
  } catch (err) {
    console.error('[api/v1/gpus] error:', err);
    return NextResponse.json(
      { error: { code: 'SERVICE_UNAVAILABLE', message: 'GPU data is unavailable' } },
      { status: 503 },
    );
  }
}
