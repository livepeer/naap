import { NextResponse } from 'next/server';
import { getSearchIndex } from '@/lib/docs/content';

export async function GET() {
  const index = getSearchIndex();
  return NextResponse.json(index, {
    headers: {
      'Cache-Control': 'public, max-age=3600, s-maxage=3600',
    },
  });
}
