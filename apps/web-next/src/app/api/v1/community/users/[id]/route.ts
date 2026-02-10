/**
 * Community User Profile API Routes
 * GET /api/v1/community/users/[id] - Get user profile
 * PUT /api/v1/community/users/[id] - Update user profile
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { validateSession } from '@/lib/api/auth';
import { success, errors, getAuthToken } from '@/lib/api/response';
import { validateCSRF } from '@/lib/api/csrf';

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
 * GET - Get a community user profile by profile ID
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const { id: profileId } = await params;

    const profile = await prisma.communityProfile.findUnique({
      where: { id: profileId },
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

/**
 * PUT - Update a community user profile
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const token = getAuthToken(request);
    if (!token) {
      return errors.unauthorized('No auth token provided');
    }

    const csrfError = validateCSRF(request, token);
    if (csrfError) return csrfError;

    const authUser = await validateSession(token);
    if (!authUser) {
      return errors.unauthorized('Invalid or expired session');
    }

    const { id: profileId } = await params;
    const body = await request.json();
    const { displayName, bio, avatarUrl } = body;

    const profile = await prisma.communityProfile.findUnique({
      where: { id: profileId },
    });

    if (!profile) {
      return errors.notFound('User');
    }

    // Auth check: only the profile owner can update
    if (profile.userId !== authUser.id) {
      return errors.forbidden('Not authorized to update this profile');
    }

    // displayName, bio, avatarUrl live on the User model
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const updateData: Record<string, any> = {};
    if (displayName !== undefined) updateData.displayName = displayName;
    if (bio !== undefined) updateData.bio = bio;
    if (avatarUrl !== undefined) updateData.avatarUrl = avatarUrl;

    if (Object.keys(updateData).length > 0) {
      await prisma.user.update({
        where: { id: profile.userId },
        data: updateData,
      });
    }

    // Return the updated profile with user data
    const updatedProfile = await prisma.communityProfile.findUnique({
      where: { id: profileId },
      include: {
        user: { select: { id: true, address: true, displayName: true, avatarUrl: true, bio: true } },
      },
    });

    return success({
      ...formatProfile(updatedProfile as unknown as Record<string, unknown>),
      bio: (updatedProfile?.user as Record<string, unknown> | undefined)?.bio || '',
    });
  } catch (err) {
    console.error('Update user error:', err);
    return errors.internal('Failed to update user profile');
  }
}
