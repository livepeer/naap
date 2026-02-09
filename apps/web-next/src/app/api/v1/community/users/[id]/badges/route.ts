/**
 * Community User Badges API Routes
 * GET /api/v1/community/users/[id]/badges - Get badges for a user
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { success, errors } from '@/lib/api/response';

/**
 * GET - Get all badges earned by a user
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const { id: profileId } = await params;

    const profile = await prisma.communityProfile.findUnique({
      where: { id: profileId },
    });

    if (!profile) {
      return errors.notFound('User');
    }

    const userBadges = await prisma.communityUserBadge.findMany({
      where: { profileId: profile.id },
      include: { badge: true },
      orderBy: { earnedAt: 'desc' },
    });

    const badges = userBadges.map((ub) => ({
      ...ub.badge,
      earnedAt: ub.earnedAt,
    }));

    return success(badges);
  } catch (err) {
    console.error('User badges error:', err);
    return errors.internal('Failed to get user badges');
  }
}
