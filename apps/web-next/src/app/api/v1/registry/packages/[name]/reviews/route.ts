/**
 * Plugin Reviews API Route
 * GET /api/v1/registry/packages/:name/reviews - List reviews with aggregate rating
 * POST /api/v1/registry/packages/:name/reviews - Submit or update a review
 * DELETE /api/v1/registry/packages/:name/reviews - Delete own review
 *
 * Uses Prisma directly (same pattern as community comments).
 */

import {NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { validateSession } from '@/lib/api/auth';
import { success, errors, getAuthToken } from '@/lib/api/response';

interface RouteParams {
  params: Promise<{ name: string }>;
}

// GET - List reviews for a package (paginated, with aggregate)
export async function GET(request: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  try {
    const { name } = await params;

    const pkg = await prisma.pluginPackage.findUnique({ where: { name } });
    if (!pkg) {
      return errors.notFound('Package');
    }

    const searchParams = request.nextUrl.searchParams;
    const page = Math.max(1, parseInt(searchParams.get('page') || '1'));
    const limit = Math.min(50, Math.max(1, parseInt(searchParams.get('limit') || '20')));

    const [reviews, totalRatings, aggResult, distributionRaw] = await Promise.all([
      prisma.pluginReview.findMany({
        where: { packageId: pkg.id },
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: (page - 1) * limit,
      }),
      prisma.pluginReview.count({ where: { packageId: pkg.id } }),
      prisma.pluginReview.aggregate({
        where: { packageId: pkg.id },
        _avg: { rating: true },
      }),
      prisma.pluginReview.groupBy({
        by: ['rating'],
        where: { packageId: pkg.id },
        _count: { rating: true },
      }),
    ]);

    const distribution: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    distributionRaw.forEach(d => {
      distribution[d.rating] = d._count.rating;
    });

    const avgRating = aggResult._avg.rating;

    return success({
      reviews: reviews.map(r => ({
        id: r.id,
        displayName: r.displayName || 'Anonymous',
        rating: r.rating,
        comment: r.comment,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      })),
      aggregate: {
        averageRating: avgRating !== null ? Math.round(avgRating * 10) / 10 : null,
        totalRatings,
        distribution,
      },
      pagination: {
        page,
        limit,
        totalPages: Math.ceil(totalRatings / limit),
      },
    });
  } catch (err) {
    console.error('Error fetching reviews:', err);
    return errors.internal('Failed to fetch reviews');
  }
}

// POST - Submit or update a review (upsert)
export async function POST(request: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  try {
    const { name } = await params;

    // Authenticate
    const token = getAuthToken(request);
    if (!token) {
      return errors.unauthorized('No auth token provided');
    }

    const authUser = await validateSession(token);
    if (!authUser) {
      return errors.unauthorized('Invalid or expired session');
    }

    // Parse body
    const body = await request.json();
    const rating = Number(body.rating);
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      return errors.badRequest('rating must be an integer between 1 and 5');
    }

    const comment = body.comment;
    if (comment !== undefined && comment !== null) {
      if (typeof comment !== 'string' || comment.length > 2000) {
        return errors.badRequest('comment must be a string with max 2000 characters');
      }
    }

    // Find package
    const pkg = await prisma.pluginPackage.findUnique({ where: { name } });
    if (!pkg) {
      return errors.notFound('Package');
    }

    const displayName = authUser.displayName || authUser.email?.split('@')[0] || 'Anonymous';

    // Atomic: upsert review + recalculate aggregate
    const review = await prisma.$transaction(async (tx) => {
      const rev = await tx.pluginReview.upsert({
        where: { packageId_userId: { packageId: pkg.id, userId: authUser.id } },
        create: {
          packageId: pkg.id,
          userId: authUser.id,
          rating,
          comment: comment || null,
          displayName,
        },
        update: {
          rating,
          comment: comment || null,
          displayName,
        },
      });

      // Recalculate aggregate rating
      const agg = await tx.pluginReview.aggregate({
        where: { packageId: pkg.id },
        _avg: { rating: true },
      });
      await tx.pluginPackage.update({
        where: { id: pkg.id },
        data: { rating: agg._avg.rating },
      });

      return rev;
    });

    return success({
      id: review.id,
      rating: review.rating,
      comment: review.comment,
      displayName: review.displayName,
      createdAt: review.createdAt,
      updatedAt: review.updatedAt,
    });
  } catch (err) {
    console.error('Error submitting review:', err);
    return errors.internal('Failed to submit review');
  }
}

// DELETE - Delete own review
export async function DELETE(request: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  try {
    const { name } = await params;

    const token = getAuthToken(request);
    if (!token) {
      return errors.unauthorized('No auth token provided');
    }

    const authUser = await validateSession(token);
    if (!authUser) {
      return errors.unauthorized('Invalid or expired session');
    }

    const pkg = await prisma.pluginPackage.findUnique({ where: { name } });
    if (!pkg) {
      return errors.notFound('Package');
    }

    // Atomic: delete review + recalculate aggregate
    await prisma.$transaction(async (tx) => {
      await tx.pluginReview.deleteMany({
        where: { packageId: pkg.id, userId: authUser.id },
      });

      const agg = await tx.pluginReview.aggregate({
        where: { packageId: pkg.id },
        _avg: { rating: true },
      });
      await tx.pluginPackage.update({
        where: { id: pkg.id },
        data: { rating: agg._avg.rating },
      });
    });

    return success(null);
  } catch (err) {
    console.error('Error deleting review:', err);
    return errors.internal('Failed to delete review');
  }
}
