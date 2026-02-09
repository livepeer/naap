/**
 * Community Post Vote API Routes
 * GET  /api/v1/community/posts/[id]/vote - Check if user voted
 * POST /api/v1/community/posts/[id]/vote - Upvote a post
 * DELETE /api/v1/community/posts/[id]/vote - Remove vote
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { validateSession } from '@/lib/api/auth';
import { success, errors, getAuthToken } from '@/lib/api/response';
import { validateCSRF } from '@/lib/api/csrf';

const REPUTATION_POINTS = {
  POST_UPVOTED: 10,
  POST_RECEIVED_UPVOTE: 2,
};

async function getOrCreateCommunityProfile(userId: string) {
  let profile = await prisma.communityProfile.findUnique({ where: { userId } });
  if (!profile) {
    profile = await prisma.communityProfile.create({ data: { userId } });
  }
  return profile;
}

const LEVEL_THRESHOLDS = [0, 50, 200, 500, 1000, 2500];

function calculateLevel(reputation: number): number {
  for (let i = LEVEL_THRESHOLDS.length - 1; i >= 0; i--) {
    if (reputation >= LEVEL_THRESHOLDS[i]) return i + 1;
  }
  return 1;
}

async function awardReputation(
  profileId: string,
  action: string,
  points: number,
  sourceType?: string,
  sourceId?: string
) {
  await prisma.communityReputationLog.create({
    data: {
      profileId,
      action: action as 'POST_UPVOTED' | 'POST_RECEIVED_UPVOTE',
      points,
      sourceType,
      sourceId,
    },
  });

  const profile = await prisma.communityProfile.update({
    where: { id: profileId },
    data: { reputation: { increment: points } },
  });

  const newLevel = calculateLevel(profile.reputation);
  if (newLevel !== profile.level) {
    await prisma.communityProfile.update({
      where: { id: profileId },
      data: { level: newLevel },
    });
  }
}

/**
 * GET - Check if the current user voted on this post
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const { id: postId } = await params;
    const token = getAuthToken(request);

    if (!token) {
      return success({ voted: false });
    }

    const authUser = await validateSession(token);
    if (!authUser) {
      return success({ voted: false });
    }

    const profile = await prisma.communityProfile.findUnique({
      where: { userId: authUser.id },
    });

    if (!profile) {
      return success({ voted: false });
    }

    const vote = await prisma.communityVote.findUnique({
      where: {
        profileId_targetType_targetId: {
          profileId: profile.id,
          targetType: 'POST',
          targetId: postId,
        },
      },
    });

    return success({ voted: !!vote });
  } catch (err) {
    console.error('Check vote error:', err);
    return errors.internal('Failed to check vote status');
  }
}

/**
 * POST - Upvote a post
 */
export async function POST(
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

    const { id: postId } = await params;
    const profile = await getOrCreateCommunityProfile(authUser.id);

    const post = await prisma.communityPost.findUnique({
      where: { id: postId },
      include: { author: true },
    });

    if (!post) {
      return errors.notFound('Post');
    }

    // Check for existing vote
    const existingVote = await prisma.communityVote.findUnique({
      where: {
        profileId_targetType_targetId: {
          profileId: profile.id,
          targetType: 'POST',
          targetId: postId,
        },
      },
    });

    if (existingVote) {
      return errors.badRequest('Already voted on this post');
    }

    // Create the vote
    await prisma.communityVote.create({
      data: {
        profileId: profile.id,
        targetType: 'POST',
        targetId: postId,
        postId,
        value: 1,
      },
    });

    const updatedPost = await prisma.communityPost.update({
      where: { id: postId },
      data: { upvotes: { increment: 1 } },
    });

    // Award reputation to voter and post author
    await awardReputation(profile.id, 'POST_UPVOTED', REPUTATION_POINTS.POST_UPVOTED, 'post', postId);
    await awardReputation(post.authorId, 'POST_RECEIVED_UPVOTE', REPUTATION_POINTS.POST_RECEIVED_UPVOTE, 'post', postId);

    return success({ upvotes: updatedPost.upvotes, voted: true });
  } catch (err) {
    console.error('Vote error:', err);
    return errors.internal('Failed to vote on post');
  }
}

/**
 * DELETE - Remove vote from a post
 */
export async function DELETE(
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

    const { id: postId } = await params;
    const profile = await getOrCreateCommunityProfile(authUser.id);

    const vote = await prisma.communityVote.findUnique({
      where: {
        profileId_targetType_targetId: {
          profileId: profile.id,
          targetType: 'POST',
          targetId: postId,
        },
      },
    });

    if (!vote) {
      return errors.badRequest('No vote to remove');
    }

    await prisma.communityVote.delete({ where: { id: vote.id } });

    const updatedPost = await prisma.communityPost.update({
      where: { id: postId },
      data: { upvotes: { decrement: 1 } },
    });

    return success({ upvotes: updatedPost.upvotes, voted: false });
  } catch (err) {
    console.error('Remove vote error:', err);
    return errors.internal('Failed to remove vote');
  }
}
