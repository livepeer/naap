/**
 * Capacity Request Comments API Route
 * POST /api/v1/capacity-planner/requests/:id/comments - Add comment to request
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { validateSession } from '@/lib/api/auth';
import { success, errors, getAuthToken } from '@/lib/api/response';
import { validateCSRF } from '@/lib/api/csrf';

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function POST(request: NextRequest, { params }: RouteParams): Promise<NextResponse> {
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

    const user = await validateSession(token);
    if (!user) {
      return errors.unauthorized('Invalid or expired session');
    }

    const body = await request.json();
    const { author, text } = body;

    if (!text) {
      return errors.badRequest('text is required');
    }

    // Verify the capacity request exists
    const capacityRequest = await prisma.capacityRequest.findUnique({
      where: { id },
    });

    if (!capacityRequest) {
      return errors.notFound('Capacity request');
    }

    // Create the comment
    const comment = await prisma.capacityRequestComment.create({
      data: {
        requestId: id,
        author: author || user.displayName || user.email || 'Anonymous',
        text,
      },
    });

    return success({
      data: {
        id: comment.id,
        author: comment.author,
        text: comment.text,
        timestamp: comment.createdAt.toISOString(),
      },
    });
  } catch (err) {
    console.error('Error adding comment:', err);
    return errors.internal('Failed to add comment');
  }
}
