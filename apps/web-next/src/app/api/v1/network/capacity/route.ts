import { NextResponse } from 'next/server';
import { getNetCapacity } from '@/lib/facade';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(): Promise<NextResponse> {
  try {
    const capacityByPipelineModel = await getNetCapacity();
    return NextResponse.json({ capacityByPipelineModel });
  } catch (err) {
    console.error('[network/capacity] error:', err);
    return NextResponse.json(
      { error: { code: 'SERVICE_UNAVAILABLE', message: 'Network capacity data is unavailable' } },
      { status: 503 },
    );
  }
}
