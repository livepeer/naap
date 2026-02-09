/**
 * Community Accept Answer API Routes
 * POST /api/v1/community/comments/[id]/accept - Accept a comment as the answer
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { validateSession } from '@/lib/api/auth';
import { success, errors, getAuthToken } from '@/lib/api/response';
import { validateCSRF } from '@/lib/api/csrf';

const REPUTATION_POINTS = {
  ANSWER_ACCEPTED: 15,
  QUESTION_SOLVED: 5,
};

const PROFILE_WITH_USER_SELECT = {
  id: true,
  reputation: true,
  level: true,
  user: {
    select: {
      id: true,
      address: true,
      displayName: true,
      avatarUrl: true,
    },
  },
} as const;

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
      action: action as 'ANSWER_ACCEPTED' | 'QUESTION_SOLVED',
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
 * POST - Accept a comment as the answer to a question
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

    const comment = await prisma.communityComment.findUnique({
      where: { id: commentId },
      include: {
        post: { include: { author: { include: { user: true } } } },
        author: true,
      },
    });

    if (!comment) {
      return errors.notFound('Comment');
    }

    // Only the post author can accept an answer
    if (comment.post.author.userId !== authUser.id) {
      return errors.forbidden('Only the post author can accept an answer');
    }

    // Unaccept any previously accepted answers on this post
    await prisma.communityComment.updateMany({
      where: { postId: comment.postId, isAccepted: true },
      data: { isAccepted: false },
    });

    // Accept this comment
    const updatedComment = await prisma.communityComment.update({
      where: { id: commentId },
      data: { isAccepted: true },
      include: {
        author: {
          select: PROFILE_WITH_USER_SELECT,
        },
      },
    });

    // Mark post as solved
    await prisma.communityPost.update({
      where: { id: comment.postId },
      data: { isSolved: true, acceptedAnswerId: comment.id },
    });

    // Award reputation to the answer author and the question author
    await awardReputation(comment.authorId, 'ANSWER_ACCEPTED', REPUTATION_POINTS.ANSWER_ACCEPTED, 'comment', comment.id);
    await awardReputation(comment.post.authorId, 'QUESTION_SOLVED', REPUTATION_POINTS.QUESTION_SOLVED, 'post', comment.postId);

    return success({
      ...updatedComment,
      author: formatProfile(updatedComment.author as unknown as Record<string, unknown>),
    });
  } catch (err) {
    console.error('Accept answer error:', err);
    return errors.internal('Failed to accept answer');
  }
}
