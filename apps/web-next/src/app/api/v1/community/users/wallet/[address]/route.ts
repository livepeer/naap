/**
 * Community User Wallet Lookup API Routes
 * GET /api/v1/community/users/wallet/[address] - Get profile by wallet address
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { success, errors } from '@/lib/api/response';

const LEVEL_NAMES = ['Newcomer', 'Contributor', 'Regular', 'Trusted', 'Expert', 'Legend'];

function formatProfile(profile: Record<string, unknown> | null) {
  if (!profile) return null;
  const user = profile.user as Record<string, unknown> | undefined;
  return {
    id: profile.id,
    walletAddress: user?.address || '',
    displayName: user?.displayName || '',
    avatarUrl: user?.avatarUrl || '',
    reputation: profile.reputation,
    level: profile.level,
  };
}

/**
 * GET - Look up a community user by their wallet address
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ address: string }> }
): Promise<NextResponse> {
  try {
    const { address } = await params;

    // In the unified schema, address lives on User — find User first
    const user = await prisma.user.findUnique({
      where: { address },
      select: { id: true },
    });

    if (!user) {
      return errors.notFound('User');
    }

    const profile = await prisma.communityProfile.findUnique({
      where: { userId: user.id },
      include: {
        user: { select: { id: true, address: true, displayName: true, avatarUrl: true, bio: true } },
        badges: { include: { badge: true } },
        _count: { select: { posts: true, comments: true } },
      },
    });

    if (!profile) {
      return errors.notFound('User');
    }

    const level = profile.level as number;

    return success({
      ...formatProfile(profile as unknown as Record<string, unknown>),
      bio: (profile.user as Record<string, unknown>)?.bio || '',
      levelName: LEVEL_NAMES[level - 1] || 'Unknown',
      badges: profile.badges.map((ub: { badge: unknown }) => ub.badge),
      postCount: profile._count.posts,
      commentCount: profile._count.comments,
    });
  } catch (err) {
    console.error('User profile error:', err);
    return errors.internal('Failed to get user profile');
  }
}
