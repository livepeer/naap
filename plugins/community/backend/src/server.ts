/**
 * Community Hub Backend - v1.3
 * Complete implementation with all features:
 * - Posts CRUD
 * - Comments/Answers
 * - Voting
 * - Reputation
 * - Search
 * - Badges
 *
 * Migrated to @naap/plugin-server-sdk for standardized server setup.
 * Uses unified database schema (packages/database) with CommunityProfile.
 */

import 'dotenv/config';
import { createPluginServer } from '@naap/plugin-server-sdk';
import { db } from './db/client.js';

// ============================================
// REPUTATION POINTS CONFIG
// ============================================

const REPUTATION_POINTS = {
  POST_CREATED: 5,
  POST_UPVOTED: 10,
  POST_RECEIVED_UPVOTE: 2,
  COMMENT_CREATED: 2,
  COMMENT_UPVOTED: 5,
  COMMENT_RECEIVED_UPVOTE: 1,
  ANSWER_ACCEPTED: 15,
  QUESTION_SOLVED: 5,
  DAILY_LOGIN: 1,
};

const LEVEL_THRESHOLDS = [0, 50, 200, 500, 1000, 2500];
const LEVEL_NAMES = ['Newcomer', 'Contributor', 'Regular', 'Trusted', 'Expert', 'Legend'];

function calculateLevel(reputation: number): number {
  for (let i = LEVEL_THRESHOLDS.length - 1; i >= 0; i--) {
    if (reputation >= LEVEL_THRESHOLDS[i]) return i + 1;
  }
  return 1;
}

// ============================================
// SHARED SELECT & FORMAT HELPERS
// ============================================

/**
 * Standard select clause for CommunityProfile when used as author.
 * CommunityProfile links to User via userId; displayName/avatarUrl/address
 * live on the User model, so we include the `user` relation.
 */
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

/**
 * Flatten a CommunityProfile (with nested user) into the API response shape.
 * Frontend expects: { id, walletAddress, displayName, avatarUrl, reputation, level }
 */
function formatProfile(profile: any) {
  if (!profile) return null;
  return {
    id: profile.id,
    walletAddress: profile.user?.address || '',
    displayName: profile.user?.displayName || '',
    avatarUrl: profile.user?.avatarUrl || '',
    reputation: profile.reputation,
    level: profile.level,
  };
}

// ============================================
// HELPER: Get userId from request (JWT auth or body fallback)
// ============================================

function getUserId(req: any): string | null {
  return req.user?.id || req.body?.userId || null;
}

function getUserIdFromQuery(req: any): string | null {
  return req.user?.id || (req.query?.userId as string) || null;
}

// ============================================
// HELPER: Get or Create CommunityProfile
// In the unified schema, CommunityProfile.userId is a @unique FK to User.id.
// The userId here is the User.id (from JWT or request).
// ============================================

async function getOrCreateProfile(userId: string): Promise<any> {
  let profile = await db.communityProfile.findUnique({
    where: { userId },
    include: { user: { select: { id: true, address: true, displayName: true, avatarUrl: true } } },
  });
  if (!profile) {
    profile = await db.communityProfile.create({
      data: { userId },
      include: { user: { select: { id: true, address: true, displayName: true, avatarUrl: true } } },
    });
  }
  return profile;
}

// ============================================
// HELPER: Award Reputation
// CommunityReputationLog uses profileId (not userId) in the unified schema.
// ============================================

async function awardReputation(
  profileId: string,
  action: string,
  points: number,
  sourceType?: string,
  sourceId?: string
) {
  await db.communityReputationLog.create({
    data: {
      profileId,
      action: action as any,
      points,
      sourceType,
      sourceId,
    },
  });

  const profile = await db.communityProfile.update({
    where: { id: profileId },
    data: { reputation: { increment: points } },
  });

  const newLevel = calculateLevel(profile.reputation);
  if (newLevel !== profile.level) {
    await db.communityProfile.update({
      where: { id: profileId },
      data: { level: newLevel },
    });
    await checkBadges(profileId);
  }

  return profile;
}

// ============================================
// HELPER: Check and Award Badges
// CommunityUserBadge uses profileId (not userId) in the unified schema.
// ============================================

async function checkBadges(profileId: string) {
  const profile = await db.communityProfile.findUnique({
    where: { id: profileId },
    include: {
      posts: true,
      comments: { where: { isAccepted: true } },
      badges: true,
    },
  });

  if (!profile) return;

  const allBadges = await db.communityBadge.findMany();

  for (const badge of allBadges) {
    const alreadyEarned = await db.communityUserBadge.findFirst({
      where: { profileId, badgeId: badge.id },
    });
    if (alreadyEarned) continue;

    let shouldAward = false;

    switch (badge.slug) {
      case 'first-post':
        shouldAward = profile.posts.length >= 1;
        break;
      case 'helpful':
        shouldAward = profile.reputation >= 100;
        break;
      case 'problem-solver':
        shouldAward = profile.comments.length >= 3;
        break;
      case 'popular':
        const popularPost = profile.posts.find((p: any) => p.upvotes >= 25);
        shouldAward = !!popularPost;
        break;
      case 'top-contributor':
        shouldAward = profile.level >= 5;
        break;
    }

    if (shouldAward) {
      await db.communityUserBadge.create({
        data: { profileId, badgeId: badge.id },
      });
      if (badge.points > 0) {
        await awardReputation(profileId, 'BADGE_EARNED', badge.points, 'badge', badge.id);
      }
    }
  }
}

// ============================================
// CREATE SERVER
// ============================================

const server = createPluginServer({
  name: 'community',
  port: parseInt(process.env.PORT || '4006', 10),
  prisma: db,
  publicRoutes: ['/healthz', '/api/v1/community/posts', '/api/v1/community/tags', '/api/v1/community/badges', '/api/v1/community/leaderboard', '/api/v1/community/stats', '/api/v1/community/search'],
});

const { router } = server;

// ============================================
// POSTS API
// ============================================

// List posts with filtering and pagination
router.get('/community/posts', async (req, res) => {
  try {
    const {
      category,
      postType,
      solved,
      search,
      tag,
      authorId,
      sort = 'recent',
      limit = '20',
      offset = '0',
    } = req.query;

    const where: any = {};

    if (category && category !== 'all') {
      where.category = category.toString().toUpperCase().replace(/-/g, '_');
    }
    if (postType) {
      where.postType = postType.toString().toUpperCase();
    }
    if (solved === 'true') {
      where.isSolved = true;
    } else if (solved === 'false') {
      where.isSolved = false;
    }
    if (authorId) {
      where.authorId = authorId;
    }
    if (search) {
      where.OR = [
        { title: { contains: search.toString(), mode: 'insensitive' } },
        { content: { contains: search.toString(), mode: 'insensitive' } },
      ];
    }
    if (tag) {
      where.postTags = { some: { tag: { slug: tag.toString() } } };
    }

    let orderBy: any = { createdAt: 'desc' };
    if (sort === 'popular') {
      orderBy = { upvotes: 'desc' };
    } else if (sort === 'unanswered') {
      where.commentCount = 0;
      where.postType = 'QUESTION';
    }

    const [posts, total] = await Promise.all([
      db.communityPost.findMany({
        where,
        include: {
          author: {
            select: PROFILE_WITH_USER_SELECT,
          },
          postTags: { include: { tag: true } },
          _count: { select: { comments: true, votes: true } },
        },
        orderBy: [{ isPinned: 'desc' }, orderBy],
        take: parseInt(limit.toString()),
        skip: parseInt(offset.toString()),
      }),
      db.communityPost.count({ where }),
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
      author: formatProfile(post.author),
      tags: post.postTags.map((pt) => ({
        id: pt.tag.id,
        name: pt.tag.name,
        slug: pt.tag.slug,
        color: pt.tag.color,
      })),
    }));

    res.json({
      posts: formattedPosts,
      total,
      limit: parseInt(limit.toString()),
      offset: parseInt(offset.toString()),
    });
  } catch (error) {
    console.error('Posts list error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get single post
router.get('/community/posts/:id', async (req, res) => {
  try {
    const post = await db.communityPost.findUnique({
      where: { id: req.params.id },
      include: {
        author: {
          select: PROFILE_WITH_USER_SELECT,
        },
        postTags: { include: { tag: true } },
        comments: {
          include: {
            author: {
              select: PROFILE_WITH_USER_SELECT,
            },
          },
          orderBy: [{ isAccepted: 'desc' }, { upvotes: 'desc' }, { createdAt: 'asc' }],
        },
      },
    });

    if (!post) {
      return res.status(404).json({ error: 'Post not found' });
    }

    await db.communityPost.update({
      where: { id: post.id },
      data: { viewCount: { increment: 1 } },
    });

    res.json({
      ...post,
      author: formatProfile(post.author),
      comments: post.comments.map((c) => ({
        ...c,
        author: formatProfile(c.author),
      })),
      tags: post.postTags.map((pt) => ({
        id: pt.tag.id,
        name: pt.tag.name,
        slug: pt.tag.slug,
        color: pt.tag.color,
      })),
      postTags: undefined,
    });
  } catch (error) {
    console.error('Post detail error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create post
router.post('/community/posts', async (req, res) => {
  try {
    const userId = getUserId(req);
    const { title, content, postType = 'DISCUSSION', category = 'GENERAL', tags = [] } = req.body;

    if (!userId || !title || !content) {
      return res.status(400).json({ error: 'Authentication, title, and content are required' });
    }

    const profile = await getOrCreateProfile(userId);

    const post = await db.communityPost.create({
      data: {
        authorId: profile.id,
        title,
        content,
        postType: postType.toUpperCase(),
        category: category.toUpperCase().replace(/-/g, '_'),
      },
      include: {
        author: {
          select: PROFILE_WITH_USER_SELECT,
        },
      },
    });

    if (tags.length > 0) {
      for (const tagName of tags) {
        const slug = tagName.toLowerCase().replace(/\s+/g, '-');
        let tag = await db.communityTag.findUnique({ where: { slug } });
        if (!tag) {
          tag = await db.communityTag.create({ data: { name: tagName, slug } });
        }
        await db.communityPostTag.create({ data: { postId: post.id, tagId: tag.id } });
        await db.communityTag.update({ where: { id: tag.id }, data: { usageCount: { increment: 1 } } });
      }
    }

    await awardReputation(profile.id, 'POST_CREATED', REPUTATION_POINTS.POST_CREATED, 'post', post.id);
    await checkBadges(profile.id);

    res.status(201).json({ ...post, author: formatProfile(post.author) });
  } catch (error) {
    console.error('Create post error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update post
router.put('/community/posts/:id', async (req, res) => {
  try {
    const userId = getUserId(req);
    const { title, content, category } = req.body;

    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const post = await db.communityPost.findUnique({
      where: { id: req.params.id },
      include: { author: { include: { user: true } } },
    });

    if (!post) {
      return res.status(404).json({ error: 'Post not found' });
    }

    // Auth check: compare User.id (the authenticated user) with the author's linked User.id
    if (post.author.userId !== userId) {
      return res.status(403).json({ error: 'Not authorized to edit this post' });
    }

    const updatedPost = await db.communityPost.update({
      where: { id: req.params.id },
      data: {
        title: title || post.title,
        content: content || post.content,
        category: category ? category.toUpperCase().replace(/-/g, '_') : post.category,
      },
      include: {
        author: {
          select: PROFILE_WITH_USER_SELECT,
        },
      },
    });

    res.json({ ...updatedPost, author: formatProfile(updatedPost.author) });
  } catch (error) {
    console.error('Update post error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete post
router.delete('/community/posts/:id', async (req, res) => {
  try {
    const userId = getUserId(req);

    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const post = await db.communityPost.findUnique({
      where: { id: req.params.id },
      include: { author: { include: { user: true } } },
    });

    if (!post) {
      return res.status(404).json({ error: 'Post not found' });
    }

    if (post.author.userId !== userId) {
      return res.status(403).json({ error: 'Not authorized to delete this post' });
    }

    await db.communityPost.delete({ where: { id: req.params.id } });
    res.status(204).send();
  } catch (error) {
    console.error('Delete post error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================
// VOTING API
// In the unified schema, CommunityVote uses profileId (not userId)
// and the unique constraint is profileId_targetType_targetId.
// ============================================

// Vote on post
router.post('/community/posts/:id/vote', async (req, res) => {
  try {
    const userId = getUserId(req);

    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const profile = await getOrCreateProfile(userId);
    const postId = req.params.id;

    const post = await db.communityPost.findUnique({
      where: { id: postId },
      include: { author: true },
    });

    if (!post) {
      return res.status(404).json({ error: 'Post not found' });
    }

    const existingVote = await db.communityVote.findUnique({
      where: {
        profileId_targetType_targetId: {
          profileId: profile.id,
          targetType: 'POST',
          targetId: postId,
        },
      },
    });

    if (existingVote) {
      return res.status(400).json({ error: 'Already voted on this post' });
    }

    await db.communityVote.create({
      data: {
        profileId: profile.id,
        targetType: 'POST',
        targetId: postId,
        postId: postId,
        value: 1,
      },
    });

    const updatedPost = await db.communityPost.update({
      where: { id: postId },
      data: { upvotes: { increment: 1 } },
    });

    await awardReputation(profile.id, 'POST_UPVOTED', REPUTATION_POINTS.POST_UPVOTED, 'post', postId);
    await awardReputation(post.author.id, 'POST_RECEIVED_UPVOTE', REPUTATION_POINTS.POST_RECEIVED_UPVOTE, 'post', postId);

    await checkBadges(profile.id);
    await checkBadges(post.author.id);

    res.json({ upvotes: updatedPost.upvotes, voted: true });
  } catch (error) {
    console.error('Vote error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Remove vote from post
router.delete('/community/posts/:id/vote', async (req, res) => {
  try {
    const userId = getUserId(req);

    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const profile = await getOrCreateProfile(userId);
    const postId = req.params.id;

    const vote = await db.communityVote.findUnique({
      where: {
        profileId_targetType_targetId: {
          profileId: profile.id,
          targetType: 'POST',
          targetId: postId,
        },
      },
    });

    if (!vote) {
      return res.status(400).json({ error: 'No vote to remove' });
    }

    await db.communityVote.delete({ where: { id: vote.id } });

    const updatedPost = await db.communityPost.update({
      where: { id: postId },
      data: { upvotes: { decrement: 1 } },
    });

    res.json({ upvotes: updatedPost.upvotes, voted: false });
  } catch (error) {
    console.error('Remove vote error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Check if user voted on post
router.get('/community/posts/:id/vote', async (req, res) => {
  try {
    const userId = getUserIdFromQuery(req);

    if (!userId) {
      return res.json({ voted: false });
    }

    // Look up CommunityProfile by userId (FK to User.id)
    const profile = await db.communityProfile.findUnique({ where: { userId: userId.toString() } });
    if (!profile) {
      return res.json({ voted: false });
    }

    const vote = await db.communityVote.findUnique({
      where: {
        profileId_targetType_targetId: {
          profileId: profile.id,
          targetType: 'POST',
          targetId: req.params.id,
        },
      },
    });

    res.json({ voted: !!vote });
  } catch (error) {
    console.error('Check vote error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================
// COMMENTS API
// ============================================

// List comments for post
router.get('/community/posts/:id/comments', async (req, res) => {
  try {
    const comments = await db.communityComment.findMany({
      where: { postId: req.params.id },
      include: {
        author: {
          select: PROFILE_WITH_USER_SELECT,
        },
      },
      orderBy: [{ isAccepted: 'desc' }, { upvotes: 'desc' }, { createdAt: 'asc' }],
    });

    res.json(comments.map((c) => ({ ...c, author: formatProfile(c.author) })));
  } catch (error) {
    console.error('Comments list error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create comment
router.post('/community/posts/:id/comments', async (req, res) => {
  try {
    const userId = getUserId(req);
    const { content } = req.body;
    const postId = req.params.id;

    if (!userId || !content) {
      return res.status(400).json({ error: 'Authentication and content are required' });
    }

    const post = await db.communityPost.findUnique({ where: { id: postId } });
    if (!post) {
      return res.status(404).json({ error: 'Post not found' });
    }

    const profile = await getOrCreateProfile(userId);

    const comment = await db.communityComment.create({
      data: {
        postId,
        authorId: profile.id,
        content,
      },
      include: {
        author: {
          select: PROFILE_WITH_USER_SELECT,
        },
      },
    });

    await db.communityPost.update({
      where: { id: postId },
      data: { commentCount: { increment: 1 } },
    });

    await awardReputation(profile.id, 'COMMENT_CREATED', REPUTATION_POINTS.COMMENT_CREATED, 'comment', comment.id);

    res.status(201).json({ ...comment, author: formatProfile(comment.author) });
  } catch (error) {
    console.error('Create comment error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update comment
router.put('/community/comments/:id', async (req, res) => {
  try {
    const userId = getUserId(req);
    const { content } = req.body;

    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const comment = await db.communityComment.findUnique({
      where: { id: req.params.id },
      include: { author: { include: { user: true } } },
    });

    if (!comment) {
      return res.status(404).json({ error: 'Comment not found' });
    }

    if (comment.author.userId !== userId) {
      return res.status(403).json({ error: 'Not authorized to edit this comment' });
    }

    const updatedComment = await db.communityComment.update({
      where: { id: req.params.id },
      data: { content },
      include: {
        author: {
          select: PROFILE_WITH_USER_SELECT,
        },
      },
    });

    res.json({ ...updatedComment, author: formatProfile(updatedComment.author) });
  } catch (error) {
    console.error('Update comment error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete comment
router.delete('/community/comments/:id', async (req, res) => {
  try {
    const userId = getUserId(req);

    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const comment = await db.communityComment.findUnique({
      where: { id: req.params.id },
      include: { author: { include: { user: true } } },
    });

    if (!comment) {
      return res.status(404).json({ error: 'Comment not found' });
    }

    if (comment.author.userId !== userId) {
      return res.status(403).json({ error: 'Not authorized to delete this comment' });
    }

    await db.communityComment.delete({ where: { id: req.params.id } });

    await db.communityPost.update({
      where: { id: comment.postId },
      data: { commentCount: { decrement: 1 } },
    });

    res.status(204).send();
  } catch (error) {
    console.error('Delete comment error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Vote on comment
router.post('/community/comments/:id/vote', async (req, res) => {
  try {
    const userId = getUserId(req);

    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const profile = await getOrCreateProfile(userId);
    const commentId = req.params.id;

    const comment = await db.communityComment.findUnique({
      where: { id: commentId },
      include: { author: true },
    });

    if (!comment) {
      return res.status(404).json({ error: 'Comment not found' });
    }

    const existingVote = await db.communityVote.findUnique({
      where: {
        profileId_targetType_targetId: {
          profileId: profile.id,
          targetType: 'COMMENT',
          targetId: commentId,
        },
      },
    });

    if (existingVote) {
      return res.status(400).json({ error: 'Already voted on this comment' });
    }

    await db.communityVote.create({
      data: {
        profileId: profile.id,
        targetType: 'COMMENT',
        targetId: commentId,
        commentId: commentId,
        value: 1,
      },
    });

    const updatedComment = await db.communityComment.update({
      where: { id: commentId },
      data: { upvotes: { increment: 1 } },
    });

    await awardReputation(profile.id, 'COMMENT_UPVOTED', REPUTATION_POINTS.COMMENT_UPVOTED, 'comment', commentId);
    await awardReputation(comment.author.id, 'COMMENT_RECEIVED_UPVOTE', REPUTATION_POINTS.COMMENT_RECEIVED_UPVOTE, 'comment', commentId);

    res.json({ upvotes: updatedComment.upvotes, voted: true });
  } catch (error) {
    console.error('Vote comment error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Accept answer
router.post('/community/comments/:id/accept', async (req, res) => {
  try {
    const userId = getUserId(req);

    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const comment = await db.communityComment.findUnique({
      where: { id: req.params.id },
      include: {
        post: { include: { author: { include: { user: true } } } },
        author: true,
      },
    });

    if (!comment) {
      return res.status(404).json({ error: 'Comment not found' });
    }

    // Only the post author can accept an answer — compare via User.id
    if (comment.post.author.userId !== userId) {
      return res.status(403).json({ error: 'Only the post author can accept an answer' });
    }

    await db.communityComment.updateMany({
      where: { postId: comment.postId, isAccepted: true },
      data: { isAccepted: false },
    });

    const updatedComment = await db.communityComment.update({
      where: { id: req.params.id },
      data: { isAccepted: true },
      include: {
        author: {
          select: PROFILE_WITH_USER_SELECT,
        },
      },
    });

    await db.communityPost.update({
      where: { id: comment.postId },
      data: { isSolved: true, acceptedAnswerId: comment.id },
    });

    await awardReputation(comment.author.id, 'ANSWER_ACCEPTED', REPUTATION_POINTS.ANSWER_ACCEPTED, 'comment', comment.id);
    await awardReputation(comment.post.author.id, 'QUESTION_SOLVED', REPUTATION_POINTS.QUESTION_SOLVED, 'post', comment.postId);

    await checkBadges(comment.author.id);

    res.json({ ...updatedComment, author: formatProfile(updatedComment.author) });
  } catch (error) {
    console.error('Accept answer error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================
// USERS API
// ============================================

// Get user profile
router.get('/community/users/:id', async (req, res) => {
  try {
    const profile = await db.communityProfile.findUnique({
      where: { id: req.params.id },
      include: {
        user: { select: { id: true, address: true, displayName: true, avatarUrl: true } },
        badges: { include: { badge: true } },
        _count: { select: { posts: true, comments: true } },
      },
    });

    if (!profile) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({
      ...formatProfile(profile),
      bio: profile.user?.bio || '',
      levelName: LEVEL_NAMES[profile.level - 1] || 'Unknown',
      badges: profile.badges.map((ub: any) => ub.badge),
      postCount: profile._count.posts,
      commentCount: profile._count.comments,
    });
  } catch (error) {
    console.error('User profile error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get user by wallet address (look up User by address, then find their CommunityProfile)
router.get('/community/users/wallet/:address', async (req, res) => {
  try {
    // In the unified schema, address lives on User, so find the User first
    const user = await db.user.findUnique({
      where: { address: req.params.address },
      select: { id: true },
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const profile = await db.communityProfile.findUnique({
      where: { userId: user.id },
      include: {
        user: { select: { id: true, address: true, displayName: true, avatarUrl: true, bio: true } },
        badges: { include: { badge: true } },
        _count: { select: { posts: true, comments: true } },
      },
    });

    if (!profile) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({
      ...formatProfile(profile),
      bio: profile.user?.bio || '',
      levelName: LEVEL_NAMES[profile.level - 1] || 'Unknown',
      badges: profile.badges.map((ub: any) => ub.badge),
      postCount: profile._count.posts,
      commentCount: profile._count.comments,
    });
  } catch (error) {
    console.error('User profile error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update user profile
router.put('/community/users/:id', async (req, res) => {
  try {
    const userId = getUserId(req);
    const { displayName, bio, avatarUrl } = req.body;

    const profile = await db.communityProfile.findUnique({
      where: { id: req.params.id },
    });

    if (!profile) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Auth check: compare the authenticated user's id with the profile's linked userId
    if (profile.userId !== userId) {
      return res.status(403).json({ error: 'Not authorized to update this profile' });
    }

    // displayName, bio, avatarUrl live on the User model in the unified schema
    await db.user.update({
      where: { id: profile.userId },
      data: {
        ...(displayName !== undefined ? { displayName } : {}),
        ...(bio !== undefined ? { bio } : {}),
        ...(avatarUrl !== undefined ? { avatarUrl } : {}),
      },
    });

    // Return the updated profile with user data
    const updatedProfile = await db.communityProfile.findUnique({
      where: { id: req.params.id },
      include: {
        user: { select: { id: true, address: true, displayName: true, avatarUrl: true, bio: true } },
      },
    });

    res.json({
      ...formatProfile(updatedProfile),
      bio: updatedProfile?.user?.bio || '',
    });
  } catch (error) {
    console.error('Update user error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Leaderboard
router.get('/community/leaderboard', async (req, res) => {
  try {
    const { limit = '10' } = req.query;

    const profiles = await db.communityProfile.findMany({
      orderBy: { reputation: 'desc' },
      take: parseInt(limit.toString()),
      select: PROFILE_WITH_USER_SELECT,
    });

    const leaderboard = profiles.map((profile, index) => ({
      rank: index + 1,
      ...formatProfile(profile),
      levelName: LEVEL_NAMES[profile.level - 1] || 'Unknown',
    }));

    res.json(leaderboard);
  } catch (error) {
    console.error('Leaderboard error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================
// TAGS API
// ============================================

router.get('/community/tags', async (req, res) => {
  try {
    const { limit = '20' } = req.query;

    const tags = await db.communityTag.findMany({
      orderBy: { usageCount: 'desc' },
      take: parseInt(limit.toString()),
    });

    res.json(tags);
  } catch (error) {
    console.error('Tags list error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================
// BADGES API
// ============================================

router.get('/community/badges', async (req, res) => {
  try {
    const badges = await db.communityBadge.findMany({
      orderBy: { threshold: 'asc' },
    });

    res.json(badges);
  } catch (error) {
    console.error('Badges list error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get user badges
router.get('/community/users/:id/badges', async (req, res) => {
  try {
    const profile = await db.communityProfile.findUnique({ where: { id: req.params.id } });
    if (!profile) {
      return res.status(404).json({ error: 'User not found' });
    }

    const userBadges = await db.communityUserBadge.findMany({
      where: { profileId: profile.id },
      include: { badge: true },
      orderBy: { earnedAt: 'desc' },
    });

    res.json(userBadges.map((ub) => ({ ...ub.badge, earnedAt: ub.earnedAt })));
  } catch (error) {
    console.error('User badges error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================
// SEARCH API
// ============================================

router.get('/community/search', async (req, res) => {
  try {
    const { q, category, solved, tag, limit = '20', offset = '0' } = req.query;

    if (!q) {
      return res.status(400).json({ error: 'Search query is required' });
    }

    const where: any = {
      OR: [
        { title: { contains: q.toString(), mode: 'insensitive' } },
        { content: { contains: q.toString(), mode: 'insensitive' } },
      ],
    };

    if (category && category !== 'all') {
      where.category = category.toString().toUpperCase().replace(/-/g, '_');
    }
    if (solved === 'true') {
      where.isSolved = true;
    }
    if (tag) {
      where.postTags = { some: { tag: { slug: tag.toString() } } };
    }

    const [posts, total] = await Promise.all([
      db.communityPost.findMany({
        where,
        include: {
          author: {
            select: PROFILE_WITH_USER_SELECT,
          },
          postTags: { include: { tag: true } },
        },
        orderBy: [{ upvotes: 'desc' }, { createdAt: 'desc' }],
        take: parseInt(limit.toString()),
        skip: parseInt(offset.toString()),
      }),
      db.communityPost.count({ where }),
    ]);

    res.json({
      query: q,
      posts: posts.map((post) => ({
        ...post,
        author: formatProfile(post.author),
        tags: post.postTags.map((pt) => pt.tag),
        postTags: undefined,
      })),
      total,
    });
  } catch (error) {
    console.error('Search error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================
// STATS API
// ============================================

router.get('/community/stats', async (req, res) => {
  try {
    const [totalPosts, totalComments, totalUsers, solvedQuestions] = await Promise.all([
      db.communityPost.count(),
      db.communityComment.count(),
      db.communityProfile.count(),
      db.communityPost.count({ where: { isSolved: true } }),
    ]);

    res.json({
      totalPosts,
      totalComments,
      totalUsers,
      solvedQuestions,
    });
  } catch (error) {
    console.error('Stats error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================
// START SERVER
// ============================================

server.start().catch((err) => {
  console.error('Failed to start community-svc:', err);
  process.exit(1);
});
