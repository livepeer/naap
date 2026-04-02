import { NextResponse } from 'next/server';
import { getDashboardPipelineCatalog } from '@/lib/facade';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(): Promise<NextResponse> {
  try {
    const result = await getDashboardPipelineCatalog();
    const res = NextResponse.json(result);
    res.headers.set('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=900');
    return res;
  } catch (err) {
    console.error('[dashboard/pipeline-catalog] error:', err);
    return NextResponse.json(
      { error: { code: 'SERVICE_UNAVAILABLE', message: 'Pipeline catalog is unavailable' } },
      { status: 503 }
    );
  }
}
