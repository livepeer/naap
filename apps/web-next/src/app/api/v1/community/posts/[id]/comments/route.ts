/**
 * Post Comments API Routes
 * GET /api/v1/community/posts/:id/comments - List comments
 * POST /api/v1/community/posts/:id/comments - Create comment
 */

import {NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { validateSession } from '@/lib/api/auth';
import { success, errors, getAuthToken } from '@/lib/api/response';
import { validateCSRF } from '@/lib/api/csrf';

const REPUTATION_POINTS = {
  COMMENT_CREATED: 2,
};

interface RouteParams {
  params: Promise<{ id: string }>;
}

async function getOrCreateCommunityProfile(userId: string) {
  let profile = await prisma.communityProfile.findUnique({ where: { userId } });
  if (!profile) {
    profile = await prisma.communityProfile.create({
      data: { userId },
    });
  }
  return profile;
}

export async function GET(request: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  try {
    const { id: postId } = await params;

    const comments = await prisma.communityComment.findMany({
      where: { postId },
      include: {
        author: {
          select: { id: true, userId: true, reputation: true, level: true, user: { select: { displayName: true, address: true, avatarUrl: true } } },
        },
      },
      orderBy: [{ isAccepted: 'desc' }, { upvotes: 'desc' }, { createdAt: 'asc' }],
    });

    return success({ comments });
  } catch (err) {
    console.error('Comments list error:', err);
    return errors.internal('Failed to list comments');
  }
}

export async function POST(request: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  try {
    const { id: postId } = await params;

    const token = getAuthToken(request);
    if (!token) {
      return errors.unauthorized('No auth token provided');
    }

    const csrfError = validateCSRF(request, token);
    if (csrfError) {
      return csrfError;
    }

    const authUser = await validateSession(token);
    if (!authUser) {
      return errors.unauthorized('Invalid or expired session');
    }

    const body = await request.json();
    const { content } = body;

    if (!content) {
      return errors.badRequest('content is required');
    }

    // Check if post exists
    const post = await prisma.communityPost.findUnique({ where: { id: postId } });
    if (!post) {
      return errors.notFound('Post');
    }

    // Get or create community profile
    const profile = await getOrCreateCommunityProfile(authUser.id);

    const comment = await prisma.communityComment.create({
      data: {
        postId,
        authorId: profile.id,
        content,
      },
      include: {
        author: {
          select: { id: true, userId: true, reputation: true, level: true, user: { select: { displayName: true, address: true, avatarUrl: true } } },
        },
      },
    });

    // Update comment count
    await prisma.communityPost.update({
      where: { id: postId },
      data: { commentCount: { increment: 1 } },
    });

    // Award reputation
    await prisma.communityReputationLog.create({
      data: {
        profileId: profile.id,
        action: 'COMMENT_CREATED',
        points: REPUTATION_POINTS.COMMENT_CREATED,
        sourceType: 'comment',
        sourceId: comment.id,
      },
    });
    await prisma.communityProfile.update({
      where: { id: profile.id },
      data: { reputation: { increment: REPUTATION_POINTS.COMMENT_CREATED } },
    });

    return success({ comment });
  } catch (err) {
    console.error('Create comment error:', err);
    return errors.internal('Failed to create comment');
  }
}
