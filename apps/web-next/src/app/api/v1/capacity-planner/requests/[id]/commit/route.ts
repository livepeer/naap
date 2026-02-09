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
    const { userId: _clientUserId, userName: clientUserName } = body;

    // Verify the capacity request exists
    const capacityRequest = await prisma.capacityRequest.findUnique({
      where: { id },
    });

    if (!capacityRequest) {
      return errors.notFound('Capacity request');
    }

    // Toggle soft commitment: if already committed, remove; otherwise, add
    const existing = await prisma.capacitySoftCommit.findUnique({
      where: {
        requestId_userId: { requestId: id, userId: user.id },
      },
    });

    if (existing) {
      await prisma.capacitySoftCommit.delete({
        where: { id: existing.id },
      });
      return success({ action: 'removed' as const });
    }

    await prisma.capacitySoftCommit.create({
      data: {
        requestId: id,
        userId: user.id,
        userName: clientUserName || user.displayName || user.email || 'Anonymous',
        gpuCount: 1,
      },
    });

    return success({ action: 'added' as const });
  } catch (err) {
    console.error('Error creating soft commitment:', err);
    return errors.internal('Failed to create soft commitment');
  }
}
