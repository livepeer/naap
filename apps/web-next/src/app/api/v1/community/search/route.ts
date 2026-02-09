/**
 * Community Search API Routes
 * GET /api/v1/community/search - Search posts
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { success, errors, parsePagination } from '@/lib/api/response';

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
 * GET - Search community posts by query, category, solved status, and tag
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const searchParams = request.nextUrl.searchParams;
    const q = searchParams.get('q');
    const category = searchParams.get('category');
    const solved = searchParams.get('solved');
    const tag = searchParams.get('tag');
    const { pageSize, skip } = parsePagination(searchParams);

    if (!q) {
      return errors.badRequest('Search query is required');
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where: Record<string, any> = {
      OR: [
        { title: { contains: q, mode: 'insensitive' } },
        { content: { contains: q, mode: 'insensitive' } },
      ],
    };

    if (category && category !== 'all') {
      where.category = category.toUpperCase().replace(/-/g, '_');
    }
    if (solved === 'true') {
      where.isSolved = true;
    }
    if (tag) {
      where.postTags = { some: { tag: { slug: tag } } };
    }

    const [posts, total] = await Promise.all([
      prisma.communityPost.findMany({
        where,
        include: {
          author: {
            select: PROFILE_WITH_USER_SELECT,
          },
          postTags: { include: { tag: true } },
        },
        orderBy: [{ upvotes: 'desc' }, { createdAt: 'desc' }],
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
      author: formatProfile(post.author as unknown as Record<string, unknown>),
      tags: post.postTags.map((pt) => ({
        id: pt.tag.id,
        name: pt.tag.name,
        slug: pt.tag.slug,
        color: pt.tag.color,
      })),
    }));

    return success({
      query: q,
      posts: formattedPosts,
      total,
    });
  } catch (err) {
    console.error('Search error:', err);
    return errors.internal('Failed to search posts');
  }
}
