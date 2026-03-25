import { NextRequest, NextResponse } from 'next/server';
import { fetchPipelineUnitCostFromClickHouse } from '@/lib/dashboard/pipeline-unit-cost';
import type { PipelineEntry } from '@/lib/api/types/public-api';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(request: NextRequest): Promise<NextResponse> {
  const pipelineFilter = request.nextUrl.searchParams.get('pipeline') ?? undefined;

  try {
    let rows = await fetchPipelineUnitCostFromClickHouse();

    if (pipelineFilter) {
      rows = rows.filter((r) => r.unit === pipelineFilter || r.pipeline === pipelineFilter);
    }

    const body: PipelineEntry[] = rows.map((r) => ({
      id: r.pipeline,
      capability: r.unit,
      price_per_unit_wei: r.price,
      avg_pixels_per_unit: r.pixelsPerUnit ?? null,
    }));

    return NextResponse.json(body);
  } catch (err) {
    console.error('[api/v1/pipelines] error:', err);
    return NextResponse.json(
      { error: { code: 'SERVICE_UNAVAILABLE', message: 'Pipelines data is unavailable' } },
      { status: 503 },
    );
  }
}
