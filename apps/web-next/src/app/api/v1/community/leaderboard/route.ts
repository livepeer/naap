/**
 * Community Leaderboard API Route
 * GET /api/v1/community/leaderboard - Top contributors by reputation
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { success, errors } from '@/lib/api/response';

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const limit = Math.min(
      Number(request.nextUrl.searchParams.get('limit') ?? 10),
      50,
    );

    const profiles = await prisma.communityProfile.findMany({
      orderBy: { reputation: 'desc' },
      take: limit,
      include: {
        user: {
          select: { id: true, email: true, displayName: true },
        },
      },
    });

    const entries = profiles.map((p, idx) => ({
      id: p.id,
      userId: p.userId,
      displayName: p.user?.displayName ?? p.userId.slice(0, 10),
      avatarUrl: null,
      reputation: p.reputation,
      level: p.level,
      bio: p.bio,
      rank: idx + 1,
    }));

    return success(entries);
  } catch (err) {
    console.error('Leaderboard error:', err);
    // Return empty array instead of 503 so the UI degrades gracefully
    return NextResponse.json([], { status: 200 });
  }
}
