/**
 * Community Tags API Route
 * GET /api/v1/community/tags - Popular tags
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { success } from '@/lib/api/response';

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const limit = Math.min(
      Number(request.nextUrl.searchParams.get('limit') ?? 20),
      100,
    );

    const tags = await prisma.communityTag.findMany({
      orderBy: { usageCount: 'desc' },
      take: limit,
    });

    return success(tags);
  } catch (err) {
    console.error('Tags error:', err);
    // Return empty array instead of 503 so the UI degrades gracefully
    return NextResponse.json([], { status: 200 });
  }
}
