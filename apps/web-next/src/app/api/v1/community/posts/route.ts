/**
 * Community Posts API Routes
 * GET /api/v1/community/posts - List posts
 * POST /api/v1/community/posts - Create post
 */

import {NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { validateSession } from '@/lib/api/auth';
import { success, errors, getAuthToken, parsePagination } from '@/lib/api/response';
import { validateCSRF } from '@/lib/api/csrf';

const REPUTATION_POINTS = {
  POST_CREATED: 5,
};

async function getOrCreateCommunityProfile(userId: string) {
  let profile = await prisma.communityProfile.findUnique({ where: { userId } });
  if (!profile) {
    profile = await prisma.communityProfile.create({
      data: { userId },
    });
  }
  return profile;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const searchParams = request.nextUrl.searchParams;
    const { page, pageSize, skip } = parsePagination(searchParams);
    const category = searchParams.get('category');
    const postType = searchParams.get('postType');
    const solved = searchParams.get('solved');
    const search = searchParams.get('search');
    const sort = searchParams.get('sort') || 'recent';

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where: Record<string, any> = {};

    if (category && category !== 'all') {
      where.category = category.toUpperCase().replace(/-/g, '_');
    }
    if (postType) {
      where.postType = postType.toUpperCase();
    }
    if (solved === 'true') {
      where.isSolved = true;
    } else if (solved === 'false') {
      where.isSolved = false;
    }
    if (search) {
      where.OR = [
        { title: { contains: search, mode: 'insensitive' } },
        { content: { contains: search, mode: 'insensitive' } },
      ];
    }

    let orderBy: { createdAt?: 'desc'; upvotes?: 'desc' } = { createdAt: 'desc' };
    if (sort === 'popular') {
      orderBy = { upvotes: 'desc' };
    } else if (sort === 'unanswered') {
      where.commentCount = 0;
      where.postType = 'QUESTION';
    }

    const [posts, total] = await Promise.all([
      prisma.communityPost.findMany({
        where,
        include: {
          author: {
            select: { id: true, userId: true, reputation: true, level: true, user: { select: { displayName: true, address: true, avatarUrl: true } } },
          },
          postTags: { include: { tag: true } },
          _count: { select: { comments: true, votes: true } },
        },
        orderBy: [{ isPinned: 'desc' }, orderBy],
        take: pageSize,
        skip,
      }),
      prisma.communityPost.count({ where }),
    ]);

    const formattedPosts = posts.map((post) => ({
      id: post.id,
      title: post.title,
      content: post.content,
      postType: post.postType,
      category: post.category,
      status: post.status,
      upvotes: post.upvotes,
      viewCount: post.viewCount,
      commentCount: post.commentCount,
      isSolved: post.isSolved,
      isPinned: post.isPinned,
      createdAt: post.createdAt.toISOString(),
      updatedAt: post.updatedAt.toISOString(),
      author: post.author,
      tags: post.postTags.map((pt) => ({
        id: pt.tag.id,
        name: pt.tag.name,
        slug: pt.tag.slug,
        color: pt.tag.color,
      })),
    }));

    return success(
      { posts: formattedPosts },
      { page, pageSize, total, totalPages: Math.ceil(total / pageSize) }
    );
  } catch (err) {
    console.error('Posts list error:', err);
    return errors.internal('Failed to list posts');
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
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
    const { title, content, postType = 'DISCUSSION', category = 'GENERAL', tags = [] } = body;

    if (!title || !content) {
      return errors.badRequest('title and content are required');
    }

    // Get or create community profile
    const profile = await getOrCreateCommunityProfile(authUser.id);

    // Create post
    const post = await prisma.communityPost.create({
      data: {
        authorId: profile.id,
        title,
        content,
        postType: postType.toUpperCase(),
        category: category.toUpperCase().replace(/-/g, '_'),
      },
      include: {
        author: {
          select: { id: true, userId: true, reputation: true, level: true, user: { select: { displayName: true, address: true, avatarUrl: true } } },
        },
      },
    });

    // Add tags
    if (tags.length > 0) {
      for (const tagName of tags) {
        const slug = tagName.toLowerCase().replace(/\s+/g, '-');
        let tag = await prisma.communityTag.findUnique({ where: { slug } });
        if (!tag) {
          tag = await prisma.communityTag.create({ data: { name: tagName, slug } });
        }
        await prisma.communityPostTag.create({ data: { postId: post.id, tagId: tag.id } });
        await prisma.communityTag.update({ where: { id: tag.id }, data: { usageCount: { increment: 1 } } });
      }
    }

    // Award reputation
    await prisma.communityReputationLog.create({
      data: {
        profileId: profile.id,
        action: 'POST_CREATED',
        points: REPUTATION_POINTS.POST_CREATED,
        sourceType: 'post',
        sourceId: post.id,
      },
    });
    await prisma.communityProfile.update({
      where: { id: profile.id },
      data: { reputation: { increment: REPUTATION_POINTS.POST_CREATED } },
    });

    return success({ post });
  } catch (err) {
    console.error('Create post error:', err);
    return errors.internal('Failed to create post');
  }
}
