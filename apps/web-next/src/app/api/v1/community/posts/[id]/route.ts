/**
 * Single Community Post API Routes
 * GET /api/v1/community/posts/:id - Get post
 * PUT /api/v1/community/posts/:id - Update post
 * DELETE /api/v1/community/posts/:id - Delete post
 */

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { validateSession } from '@/lib/api/auth';
import { success, errors, getAuthToken } from '@/lib/api/response';
import { validateCSRF } from '@/lib/api/csrf';

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;

    const post = await prisma.communityPost.findUnique({
      where: { id },
      include: {
        author: {
          select: { id: true, walletAddress: true, displayName: true, avatarUrl: true, reputation: true, level: true },
        },
        postTags: { include: { tag: true } },
        comments: {
          include: {
            author: {
              select: { id: true, walletAddress: true, displayName: true, avatarUrl: true, reputation: true, level: true },
            },
          },
          orderBy: [{ isAccepted: 'desc' }, { upvotes: 'desc' }, { createdAt: 'asc' }],
        },
      },
    });

    if (!post) {
      return errors.notFound('Post');
    }

    // Increment view count
    await prisma.communityPost.update({
      where: { id },
      data: { viewCount: { increment: 1 } },
    });

    return success({
      ...post,
      tags: post.postTags.map((pt) => ({
        id: pt.tag.id,
        name: pt.tag.name,
        slug: pt.tag.slug,
        color: pt.tag.color,
      })),
    });
  } catch (err) {
    console.error('Post detail error:', err);
    return errors.internal('Failed to get post');
  }
}

export async function PUT(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;

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

    const post = await prisma.communityPost.findUnique({
      where: { id },
      include: { author: true },
    });

    if (!post) {
      return errors.notFound('Post');
    }

    // Check ownership
    if (post.author.walletAddress !== authUser.id) {
      return errors.forbidden('Not authorized to edit this post');
    }

    const body = await request.json();
    const { title, content, category } = body;

    const updatedPost = await prisma.communityPost.update({
      where: { id },
      data: {
        ...(title !== undefined && { title }),
        ...(content !== undefined && { content }),
        ...(category !== undefined && { category: category.toUpperCase().replace(/-/g, '_') }),
      },
      include: {
        author: {
          select: { id: true, walletAddress: true, displayName: true, avatarUrl: true, reputation: true, level: true },
        },
      },
    });

    return success({ post: updatedPost });
  } catch (err) {
    console.error('Update post error:', err);
    return errors.internal('Failed to update post');
  }
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;

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

    const post = await prisma.communityPost.findUnique({
      where: { id },
      include: { author: true },
    });

    if (!post) {
      return errors.notFound('Post');
    }

    // Check ownership
    if (post.author.walletAddress !== authUser.id) {
      return errors.forbidden('Not authorized to delete this post');
    }

    await prisma.communityPost.delete({ where: { id } });

    return success({ deleted: true });
  } catch (err) {
    console.error('Delete post error:', err);
    return errors.internal('Failed to delete post');
  }
}
