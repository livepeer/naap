/**
 * Community Hub Backend - v1.2
 * Complete implementation with all features:
 * - Posts CRUD
 * - Comments/Answers
 * - Voting
 * - Reputation
 * - Search
 * - Badges
 *
 * Migrated to @naap/plugin-server-sdk for standardized server setup.
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
// HELPER: Get userId from request (JWT auth or body fallback)
// ============================================

function getUserId(req: any): string | null {
  return req.user?.id || req.body?.userId || null;
}

function getUserIdFromQuery(req: any): string | null {
  return req.user?.id || (req.query?.userId as string) || null;
}

// ============================================
// HELPER: Get or Create User
// ============================================

async function getOrCreateUser(userId: string, displayName?: string) {
  // userId is stored in walletAddress field (unique identifier)
  let user = await db.communityProfile.findUnique({ where: { walletAddress: userId } });
  if (!user) {
    user = await db.communityProfile.create({
      data: {
        walletAddress: userId,
        displayName: displayName || userId.slice(0, 10),
      },
    });
  } else if (displayName && user.displayName !== displayName) {
    user = await db.communityProfile.update({
      where: { id: user.id },
      data: { displayName },
    });
  }
  return user;
}

// ============================================
// HELPER: Award Reputation
// ============================================

async function awardReputation(
  userId: string,
  action: string,
  points: number,
  sourceType?: string,
  sourceId?: string
) {
  await db.communityReputationLog.create({
    data: {
      userId,
      action: action as any,
      points,
      sourceType,
      sourceId,
    },
  });

  const user = await db.communityProfile.update({
    where: { id: userId },
    data: { reputation: { increment: points } },
  });

  const newLevel = calculateLevel(user.reputation);
  if (newLevel !== user.level) {
    await db.communityProfile.update({
      where: { id: userId },
      data: { level: newLevel },
    });
    await checkBadges(userId);
  }

  return user;
}

// ============================================
// HELPER: Check and Award Badges
// ============================================

async function checkBadges(userId: string) {
  const user = await db.communityProfile.findUnique({
    where: { id: userId },
    include: {
      posts: true,
      comments: { where: { isAccepted: true } },
      badges: true,
    },
  });

  if (!user) return;

  const allBadges = await db.communityBadge.findMany();

  for (const badge of allBadges) {
    const alreadyEarned = await db.communityUserBadge.findFirst({
      where: { userId, badgeId: badge.id },
    });
    if (alreadyEarned) continue;

    let shouldAward = false;

    switch (badge.slug) {
      case 'first-post':
        shouldAward = user.posts.length >= 1;
        break;
      case 'helpful':
        shouldAward = user.reputation >= 100;
        break;
      case 'problem-solver':
        shouldAward = user.comments.length >= 3;
        break;
      case 'popular':
        const popularPost = user.posts.find((p) => p.upvotes >= 25);
        shouldAward = !!popularPost;
        break;
      case 'top-contributor':
        shouldAward = user.level >= 5;
        break;
    }

    if (shouldAward) {
      await db.communityUserBadge.create({
        data: { userId, badgeId: badge.id },
      });
      if (badge.points > 0) {
        await awardReputation(userId, 'BADGE_EARNED', badge.points, 'badge', badge.id);
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
            select: { id: true, walletAddress: true, displayName: true, avatarUrl: true, reputation: true, level: true },
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
      author: post.author,
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
      return res.status(404).json({ error: 'Post not found' });
    }

    await db.communityPost.update({
      where: { id: post.id },
      data: { viewCount: { increment: 1 } },
    });

    res.json({
      ...post,
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

    const user = await getOrCreateUser(userId);

    const post = await db.communityPost.create({
      data: {
        authorId: user.id,
        title,
        content,
        postType: postType.toUpperCase(),
        category: category.toUpperCase().replace(/-/g, '_'),
      },
      include: {
        author: {
          select: { id: true, walletAddress: true, displayName: true, avatarUrl: true, reputation: true, level: true },
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

    await awardReputation(user.id, 'POST_CREATED', REPUTATION_POINTS.POST_CREATED, 'post', post.id);
    await checkBadges(user.id);

    res.status(201).json(post);
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
      include: { author: true },
    });

    if (!post) {
      return res.status(404).json({ error: 'Post not found' });
    }

    if (post.author.walletAddress !== userId) {
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
          select: { id: true, walletAddress: true, displayName: true, avatarUrl: true, reputation: true, level: true },
        },
      },
    });

    res.json(updatedPost);
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
      include: { author: true },
    });

    if (!post) {
      return res.status(404).json({ error: 'Post not found' });
    }

    if (post.author.walletAddress !== userId) {
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
// ============================================

// Vote on post
router.post('/community/posts/:id/vote', async (req, res) => {
  try {
    const userId = getUserId(req);

    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const user = await getOrCreateUser(userId);
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
        userId_targetType_targetId: {
          userId: user.id,
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
        userId: user.id,
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

    await awardReputation(user.id, 'POST_UPVOTED', REPUTATION_POINTS.POST_UPVOTED, 'post', postId);
    await awardReputation(post.author.id, 'POST_RECEIVED_UPVOTE', REPUTATION_POINTS.POST_RECEIVED_UPVOTE, 'post', postId);

    await checkBadges(user.id);
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

    const user = await getOrCreateUser(userId);
    const postId = req.params.id;

    const vote = await db.communityVote.findUnique({
      where: {
        userId_targetType_targetId: {
          userId: user.id,
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

    const user = await db.communityProfile.findUnique({ where: { walletAddress: userId.toString() } });
    if (!user) {
      return res.json({ voted: false });
    }

    const vote = await db.communityVote.findUnique({
      where: {
        userId_targetType_targetId: {
          userId: user.id,
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
          select: { id: true, walletAddress: true, displayName: true, avatarUrl: true, reputation: true, level: true },
        },
      },
      orderBy: [{ isAccepted: 'desc' }, { upvotes: 'desc' }, { createdAt: 'asc' }],
    });

    res.json(comments);
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

    const user = await getOrCreateUser(userId);

    const comment = await db.communityComment.create({
      data: {
        postId,
        authorId: user.id,
        content,
      },
      include: {
        author: {
          select: { id: true, walletAddress: true, displayName: true, avatarUrl: true, reputation: true, level: true },
        },
      },
    });

    await db.communityPost.update({
      where: { id: postId },
      data: { commentCount: { increment: 1 } },
    });

    await awardReputation(user.id, 'COMMENT_CREATED', REPUTATION_POINTS.COMMENT_CREATED, 'comment', comment.id);

    res.status(201).json(comment);
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
      include: { author: true },
    });

    if (!comment) {
      return res.status(404).json({ error: 'Comment not found' });
    }

    if (comment.author.walletAddress !== userId) {
      return res.status(403).json({ error: 'Not authorized to edit this comment' });
    }

    const updatedComment = await db.communityComment.update({
      where: { id: req.params.id },
      data: { content },
      include: {
        author: {
          select: { id: true, walletAddress: true, displayName: true, avatarUrl: true, reputation: true, level: true },
        },
      },
    });

    res.json(updatedComment);
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
      include: { author: true },
    });

    if (!comment) {
      return res.status(404).json({ error: 'Comment not found' });
    }

    if (comment.author.walletAddress !== userId) {
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

    const user = await getOrCreateUser(userId);
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
        userId_targetType_targetId: {
          userId: user.id,
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
        userId: user.id,
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

    await awardReputation(user.id, 'COMMENT_UPVOTED', REPUTATION_POINTS.COMMENT_UPVOTED, 'comment', commentId);
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
      include: { post: { include: { author: true } }, author: true },
    });

    if (!comment) {
      return res.status(404).json({ error: 'Comment not found' });
    }

    if (comment.post.author.walletAddress !== userId) {
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
          select: { id: true, walletAddress: true, displayName: true, avatarUrl: true, reputation: true, level: true },
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

    res.json(updatedComment);
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
    const user = await db.communityProfile.findUnique({
      where: { id: req.params.id },
      include: {
        badges: { include: { badge: true } },
        _count: { select: { posts: true, comments: true } },
      },
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({
      ...user,
      levelName: LEVEL_NAMES[user.level - 1] || 'Unknown',
      badges: user.badges.map((ub) => ub.badge),
      postCount: user._count.posts,
      commentCount: user._count.comments,
    });
  } catch (error) {
    console.error('User profile error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get user by wallet address
router.get('/community/users/wallet/:address', async (req, res) => {
  try {
    const user = await db.communityProfile.findUnique({
      where: { walletAddress: req.params.address },
      include: {
        badges: { include: { badge: true } },
        _count: { select: { posts: true, comments: true } },
      },
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({
      ...user,
      levelName: LEVEL_NAMES[user.level - 1] || 'Unknown',
      badges: user.badges.map((ub) => ub.badge),
      postCount: user._count.posts,
      commentCount: user._count.comments,
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

    const user = await db.communityProfile.findUnique({ where: { id: req.params.id } });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (user.walletAddress !== userId) {
      return res.status(403).json({ error: 'Not authorized to update this profile' });
    }

    const updatedUser = await db.communityProfile.update({
      where: { id: req.params.id },
      data: { displayName, bio, avatarUrl },
    });

    res.json(updatedUser);
  } catch (error) {
    console.error('Update user error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Leaderboard
router.get('/community/leaderboard', async (req, res) => {
  try {
    const { limit = '10' } = req.query;

    const users = await db.communityProfile.findMany({
      orderBy: { reputation: 'desc' },
      take: parseInt(limit.toString()),
      select: {
        id: true,
        walletAddress: true,
        displayName: true,
        avatarUrl: true,
        reputation: true,
        level: true,
      },
    });

    const leaderboard = users.map((user, index) => ({
      rank: index + 1,
      ...user,
      levelName: LEVEL_NAMES[user.level - 1] || 'Unknown',
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
    const user = await db.communityProfile.findUnique({ where: { id: req.params.id } });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const userBadges = await db.communityUserBadge.findMany({
      where: { userId: user.id },
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
            select: { id: true, walletAddress: true, displayName: true, avatarUrl: true, reputation: true, level: true },
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
