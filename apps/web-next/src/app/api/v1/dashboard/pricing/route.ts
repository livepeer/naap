import { NextResponse } from 'next/server';
import {
  fetchPipelineUnitCostFromClickHouse,
} from '@/lib/dashboard/pipeline-unit-cost';

export const runtime = 'nodejs';
export const maxDuration = 60;
export const revalidate = 300;

export async function GET(): Promise<NextResponse> {
  try {
    const rows = await fetchPipelineUnitCostFromClickHouse();
    return NextResponse.json(rows);
  } catch (err) {
    console.error('[dashboard/pricing] error:', err);
    return NextResponse.json(
      { error: { code: 'SERVICE_UNAVAILABLE', message: 'Pipeline unit cost data is unavailable' } },
      { status: 503 }
    );
  }
}
