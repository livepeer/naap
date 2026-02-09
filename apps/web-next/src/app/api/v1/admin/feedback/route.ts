/**
 * Admin Feedback API
 * GET /api/v1/admin/feedback - List all feedback with search/filter/pagination
 */

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { validateSession } from '@/lib/api/auth';
import {
  success,
  errors,
  getAuthToken,
  parsePagination,
} from '@/lib/api/response';
import { Prisma } from '@naap/database';

export async function GET(request: NextRequest) {
  try {
    const token = getAuthToken(request);
    if (!token) return errors.unauthorized('No auth token provided');

    const sessionUser = await validateSession(token);
    if (!sessionUser) return errors.unauthorized('Invalid or expired session');

    if (!sessionUser.roles.includes('system:admin')) {
      return errors.forbidden('Admin permission required');
    }

    const { searchParams } = new URL(request.url);
    const { page, pageSize, skip } = parsePagination(searchParams);

    // Filters
    const status = searchParams.get('status') || undefined;
    const type = searchParams.get('type') || undefined;
    const search = searchParams.get('search') || undefined;

    const where: Prisma.FeedbackWhereInput = {};

    if (status && status !== 'all') {
      where.status = status;
    }
    if (type && type !== 'all') {
      where.type = type;
    }
    if (search) {
      where.OR = [
        { title: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
        { userEmail: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [feedbacks, total] = await Promise.all([
      prisma.feedback.findMany({
        where,
        include: {
          user: {
            select: {
              id: true,
              email: true,
              displayName: true,
              avatarUrl: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize,
      }),
      prisma.feedback.count({ where }),
    ]);

    // Global stats
    const statusCounts = await prisma.feedback.groupBy({
      by: ['status'],
      _count: { status: true },
    });

    const stats: Record<string, number> = {
      total: 0,
      open: 0,
      investigating: 0,
      roadmap: 0,
      released: 0,
      closed: 0,
    };

    for (const row of statusCounts) {
      stats[row.status] = row._count.status;
      stats.total += row._count.status;
    }

    return success(
      { feedbacks, stats },
      { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    );
  } catch (err) {
    console.error('Error fetching admin feedback:', err);
    return errors.internal('Failed to fetch feedback');
  }
}
