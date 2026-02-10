/**
 * Capacity Request Detail API Route
 * GET    /api/v1/capacity-planner/requests/:id - Get request details
 * PATCH  /api/v1/capacity-planner/requests/:id - Update request
 * DELETE /api/v1/capacity-planner/requests/:id - Delete request
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { validateSession } from '@/lib/api/auth';
import { success, errors, getAuthToken } from '@/lib/api/response';
import { validateCSRF } from '@/lib/api/csrf';

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(request: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  try {
    const { id } = await params;

    const capacityRequest = await prisma.capacityRequest.findUnique({
      where: { id },
      include: {
        comments: {
          orderBy: { createdAt: 'desc' },
        },
        softCommits: {
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!capacityRequest) {
      return errors.notFound('Capacity request');
    }

    return success(capacityRequest);
  } catch (err) {
    console.error('Error fetching capacity request:', err);
    return errors.internal('Failed to fetch capacity request');
  }
}

export async function PATCH(request: NextRequest, { params }: RouteParams): Promise<NextResponse> {
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

    // Verify the capacity request exists
    const existing = await prisma.capacityRequest.findUnique({ where: { id } });
    if (!existing) {
      return errors.notFound('Capacity request');
    }

    const updated = await prisma.capacityRequest.update({
      where: { id },
      data: {
        ...(body.status && { status: body.status }),
        ...(body.gpuModel && { gpuModel: body.gpuModel }),
        ...(body.count !== undefined && { count: body.count }),
        ...(body.pipeline && { pipeline: body.pipeline }),
        ...(body.hourlyRate !== undefined && { hourlyRate: body.hourlyRate }),
        ...(body.reason && { reason: body.reason }),
        ...(body.riskLevel !== undefined && { riskLevel: body.riskLevel }),
      },
    });

    return success(updated);
  } catch (err) {
    console.error('Error updating capacity request:', err);
    return errors.internal('Failed to update capacity request');
  }
}

export async function DELETE(request: NextRequest, { params }: RouteParams): Promise<NextResponse> {
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

    // Verify the capacity request exists
    const existing = await prisma.capacityRequest.findUnique({ where: { id } });
    if (!existing) {
      return errors.notFound('Capacity request');
    }

    await prisma.capacityRequest.delete({ where: { id } });

    return success({ deletedId: id });
  } catch (err) {
    console.error('Error deleting capacity request:', err);
    return errors.internal('Failed to delete capacity request');
  }
}
