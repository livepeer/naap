/**
 * Feedback API
 * POST /api/v1/feedback - Submit user feedback (persists to DB)
 * GET  /api/v1/feedback - Get current user's feedback list + aggregate stats
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

// ─── POST: Submit Feedback ──────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    const token = getAuthToken(request);
    if (!token) return errors.unauthorized('No auth token provided');

    const sessionUser = await validateSession(token);
    if (!sessionUser) return errors.unauthorized('Invalid or expired session');

    const body = await request.json();
    const { type, title, description } = body;

    if (!type || !title || !description) {
      return errors.badRequest('Type, title, and description are required');
    }

    if (!['bug', 'feature', 'general'].includes(type)) {
      return errors.badRequest('Type must be bug, feature, or general');
    }

    const feedback = await prisma.feedback.create({
      data: {
        type,
        title: title.trim(),
        description: description.trim(),
        userId: sessionUser.id,
        userEmail: sessionUser.email,
      },
    });

    return success({
      message: 'Feedback submitted successfully',
      feedback,
    });
  } catch (err) {
    console.error('Error submitting feedback:', err);
    return errors.internal('Failed to submit feedback');
  }
}

// ─── GET: List current user's feedback + aggregate stats ────────────────────

export async function GET(request: NextRequest) {
  try {
    const token = getAuthToken(request);
    if (!token) return errors.unauthorized('No auth token provided');

    const sessionUser = await validateSession(token);
    if (!sessionUser) return errors.unauthorized('Invalid or expired session');

    const { searchParams } = new URL(request.url);
    const { page, pageSize, skip } = parsePagination(searchParams);

    // Fetch user's feedback
    const [feedbacks, total] = await Promise.all([
      prisma.feedback.findMany({
        where: { userId: sessionUser.id },
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize,
      }),
      prisma.feedback.count({ where: { userId: sessionUser.id } }),
    ]);

    // Aggregate stats for current user
    const statusCounts = await prisma.feedback.groupBy({
      by: ['status'],
      where: { userId: sessionUser.id },
      _count: { status: true },
    });

    const stats: Record<string, number> = {
      total,
      open: 0,
      investigating: 0,
      roadmap: 0,
      released: 0,
      closed: 0,
    };

    for (const row of statusCounts) {
      stats[row.status] = row._count.status;
    }

    // Fetch feedback config (external links)
    const config = await prisma.feedbackConfig.findFirst();

    return success(
      {
        feedbacks,
        stats,
        config: config
          ? { githubIssueUrl: config.githubIssueUrl, discordUrl: config.discordUrl }
          : { githubIssueUrl: '', discordUrl: '' },
      },
      { page, pageSize, total },
    );
  } catch (err) {
    console.error('Error fetching feedback:', err);
    return errors.internal('Failed to fetch feedback');
  }
}
