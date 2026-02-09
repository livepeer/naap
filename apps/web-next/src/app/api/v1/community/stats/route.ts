/**
 * Community Stats API Route
 * GET /api/v1/community/stats - Get community statistics
 */

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { success, errors } from '@/lib/api/response';

export async function GET(_request: NextRequest) {
  try {
    const [totalPosts, totalComments, totalUsers, solvedQuestions] = await Promise.all([
      prisma.communityPost.count(),
      prisma.communityComment.count(),
      prisma.communityUser.count(),
      prisma.communityPost.count({ where: { isSolved: true } }),
    ]);

    return success({
      totalPosts,
      totalComments,
      totalUsers,
      solvedQuestions,
    });
  } catch (err) {
    console.error('Stats error:', err);
    return errors.internal('Failed to fetch stats');
  }
}
