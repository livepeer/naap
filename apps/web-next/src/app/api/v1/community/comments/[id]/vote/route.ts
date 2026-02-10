/**
 * Community Comment Vote API Routes
 * POST /api/v1/community/comments/[id]/vote - Vote on a comment
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { validateSession } from '@/lib/api/auth';
import { success, errors, getAuthToken } from '@/lib/api/response';
import { validateCSRF } from '@/lib/api/csrf';

const REPUTATION_POINTS = {
  COMMENT_UPVOTED: 5,
  COMMENT_RECEIVED_UPVOTE: 1,
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
      action: action as 'COMMENT_UPVOTED' | 'COMMENT_RECEIVED_UPVOTE',
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
 * POST - Vote on a comment (upvote)
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

    const { id: commentId } = await params;
    const profile = await getOrCreateCommunityProfile(authUser.id);

    const comment = await prisma.communityComment.findUnique({
      where: { id: commentId },
      include: { author: true },
    });

    if (!comment) {
      return errors.notFound('Comment');
    }

    // Check for existing vote
    const existingVote = await prisma.communityVote.findUnique({
      where: {
        profileId_targetType_targetId: {
          profileId: profile.id,
          targetType: 'COMMENT',
          targetId: commentId,
        },
      },
    });

    if (existingVote) {
      return errors.badRequest('Already voted on this comment');
    }

    // Create the vote
    await prisma.communityVote.create({
      data: {
        profileId: profile.id,
        targetType: 'COMMENT',
        targetId: commentId,
        commentId,
        value: 1,
      },
    });

    const updatedComment = await prisma.communityComment.update({
      where: { id: commentId },
      data: { upvotes: { increment: 1 } },
    });

    // Award reputation to voter and comment author
    await awardReputation(profile.id, 'COMMENT_UPVOTED', REPUTATION_POINTS.COMMENT_UPVOTED, 'comment', commentId);
    await awardReputation(comment.authorId, 'COMMENT_RECEIVED_UPVOTE', REPUTATION_POINTS.COMMENT_RECEIVED_UPVOTE, 'comment', commentId);

    return success({ upvotes: updatedComment.upvotes, voted: true });
  } catch (err) {
    console.error('Vote comment error:', err);
    return errors.internal('Failed to vote on comment');
  }
}
