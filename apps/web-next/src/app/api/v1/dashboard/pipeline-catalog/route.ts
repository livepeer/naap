import { NextResponse } from 'next/server';
import { resolvePipelineCatalog } from '@/lib/dashboard/resolvers';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(): Promise<NextResponse> {
  try {
    const result = await resolvePipelineCatalog();
    return NextResponse.json(result);
  } catch (err) {
    console.error('[dashboard/pipeline-catalog] error:', err);
    return NextResponse.json(
      { error: { code: 'SERVICE_UNAVAILABLE', message: 'Pipeline catalog is unavailable' } },
      { status: 503 }
    );
  }
}
