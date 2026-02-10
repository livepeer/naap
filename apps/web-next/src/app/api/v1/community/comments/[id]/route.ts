/**
 * Community Comment API Routes
 * PUT    /api/v1/community/comments/[id] - Update comment
 * DELETE /api/v1/community/comments/[id] - Delete comment
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { validateSession } from '@/lib/api/auth';
import { success, errors, getAuthToken } from '@/lib/api/response';
import { validateCSRF } from '@/lib/api/csrf';

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

/**
 * PUT - Update a comment
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

    const { id: commentId } = await params;
    const body = await request.json();
    const { content } = body;

    const comment = await prisma.communityComment.findUnique({
      where: { id: commentId },
      include: { author: { include: { user: true } } },
    });

    if (!comment) {
      return errors.notFound('Comment');
    }

    if (comment.author.userId !== authUser.id) {
      return errors.forbidden('Not authorized to edit this comment');
    }

    const updatedComment = await prisma.communityComment.update({
      where: { id: commentId },
      data: { content },
      include: {
        author: {
          select: PROFILE_WITH_USER_SELECT,
        },
      },
    });

    return success({
      ...updatedComment,
      author: formatProfile(updatedComment.author as unknown as Record<string, unknown>),
    });
  } catch (err) {
    console.error('Update comment error:', err);
    return errors.internal('Failed to update comment');
  }
}

/**
 * DELETE - Delete a comment
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

    const { id: commentId } = await params;

    const comment = await prisma.communityComment.findUnique({
      where: { id: commentId },
      include: { author: { include: { user: true } } },
    });

    if (!comment) {
      return errors.notFound('Comment');
    }

    if (comment.author.userId !== authUser.id) {
      return errors.forbidden('Not authorized to delete this comment');
    }

    await prisma.communityComment.delete({ where: { id: commentId } });

    // Decrement post comment count
    await prisma.communityPost.update({
      where: { id: comment.postId },
      data: { commentCount: { decrement: 1 } },
    });

    return success(null);
  } catch (err) {
    console.error('Delete comment error:', err);
    return errors.internal('Failed to delete comment');
  }
}
