/**
 * Capacity Request Commit API Route
 * POST /api/v1/capacity-planner/requests/:id/commit - Create soft commitment
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
    const { gpuCount } = body;

    if (!gpuCount) {
      return errors.badRequest('gpuCount is required');
    }

    // Verify the capacity request exists
    const capacityRequest = await prisma.capacityRequest.findUnique({
      where: { id },
    });

    if (!capacityRequest) {
      return errors.notFound('Capacity request');
    }

    // Create the soft commitment (upsert by requestId + userId)
    const commitment = await prisma.capacitySoftCommit.upsert({
      where: {
        requestId_userId: { requestId: id, userId: user.id },
      },
      create: {
        requestId: id,
        userId: user.id,
        userName: user.displayName || user.email || 'Anonymous',
        gpuCount,
      },
      update: {
        gpuCount,
        userName: user.displayName || user.email || 'Anonymous',
      },
    });

    return success({ commitment });
  } catch (err) {
    console.error('Error creating soft commitment:', err);
    return errors.internal('Failed to create soft commitment');
  }
}
