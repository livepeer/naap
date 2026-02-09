/**
 * Single Gateway API Routes
 * GET /api/v1/gateway/:id - Get gateway details
 * PATCH /api/v1/gateway/:id - Update gateway
 * DELETE /api/v1/gateway/:id - Delete gateway
 */

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { validateSession } from '@/lib/api/auth';
import { success, errors, getAuthToken } from '@/lib/api/response';
import { validateCSRF } from '@/lib/api/csrf';

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;

    const token = getAuthToken(request);
    if (!token) {
      return errors.unauthorized('No auth token provided');
    }

    const user = await validateSession(token);
    if (!user) {
      return errors.unauthorized('Invalid or expired session');
    }

    const gateway = await prisma.gateway.findUnique({
      where: { id },
      include: {
        orchestratorConnections: true,
        performanceMetrics: {
          orderBy: { timestamp: 'desc' },
          take: 100,
        },
        configurations: true,
      },
    });

    if (!gateway) {
      return errors.notFound('Gateway');
    }

    return success({ gateway });
  } catch (err) {
    console.error('Gateway detail error:', err);
    return errors.internal('Failed to get gateway');
  }
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;

    const token = getAuthToken(request);
    if (!token) {
      return errors.unauthorized('No auth token provided');
    }

    // Validate CSRF token
    const csrfError = validateCSRF(request, token);
    if (csrfError) {
      return csrfError;
    }

    const user = await validateSession(token);
    if (!user) {
      return errors.unauthorized('Invalid or expired session');
    }

    // Check if gateway exists
    const existing = await prisma.gateway.findUnique({
      where: { id },
    });

    if (!existing) {
      return errors.notFound('Gateway');
    }

    const body = await request.json();
    const {
      operatorName,
      serviceUri,
      region,
      version,
      ip,
      status,
      supportedPipelines,
    } = body;

    const gateway = await prisma.gateway.update({
      where: { id },
      data: {
        ...(operatorName !== undefined && { operatorName }),
        ...(serviceUri !== undefined && { serviceUri }),
        ...(region !== undefined && { region }),
        ...(version !== undefined && { version }),
        ...(ip !== undefined && { ip }),
        ...(status !== undefined && { status }),
        ...(supportedPipelines !== undefined && { supportedPipelines }),
      },
      include: {
        configurations: true,
      },
    });

    return success({ gateway });
  } catch (err) {
    console.error('Update gateway error:', err);
    return errors.internal('Failed to update gateway');
  }
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;

    const token = getAuthToken(request);
    if (!token) {
      return errors.unauthorized('No auth token provided');
    }

    // Validate CSRF token
    const csrfError = validateCSRF(request, token);
    if (csrfError) {
      return csrfError;
    }

    const user = await validateSession(token);
    if (!user) {
      return errors.unauthorized('Invalid or expired session');
    }

    // Check if gateway exists
    const existing = await prisma.gateway.findUnique({
      where: { id },
    });

    if (!existing) {
      return errors.notFound('Gateway');
    }

    await prisma.gateway.delete({
      where: { id },
    });

    return success({ message: 'Gateway deleted' });
  } catch (err) {
    console.error('Delete gateway error:', err);
    return errors.internal('Failed to delete gateway');
  }
}
