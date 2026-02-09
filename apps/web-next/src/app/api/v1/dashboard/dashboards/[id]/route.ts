/**
 * Single Dashboard API Routes
 * GET /api/v1/dashboard/dashboards/:id - Get dashboard
 * PUT /api/v1/dashboard/dashboards/:id - Update dashboard
 * DELETE /api/v1/dashboard/dashboards/:id - Delete dashboard
 */

import {NextRequest, NextResponse } from 'next/server';
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

    const token = getAuthToken(request);
    if (!token) {
      return errors.unauthorized('No auth token provided');
    }

    const user = await validateSession(token);
    if (!user) {
      return errors.unauthorized('Invalid or expired session');
    }

    const dashboard = await prisma.dashboard.findUnique({
      where: { id },
    });

    if (!dashboard) {
      return errors.notFound('Dashboard');
    }

    return success({ dashboard });
  } catch (err) {
    console.error('Error fetching dashboard:', err);
    return errors.internal('Failed to fetch dashboard');
  }
}

export async function PUT(request: NextRequest, { params }: RouteParams): Promise<NextResponse> {
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
    const { name, description, thumbnail, isDefault, order } = body;

    const dashboard = await prisma.dashboard.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
        ...(description !== undefined && { description }),
        ...(thumbnail !== undefined && { thumbnail }),
        ...(isDefault !== undefined && { isDefault }),
        ...(order !== undefined && { order }),
      },
    });

    return success({ dashboard });
  } catch (err) {
    console.error('Error updating dashboard:', err);
    return errors.internal('Failed to update dashboard');
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

    await prisma.dashboard.delete({
      where: { id },
    });

    return success({ deleted: true });
  } catch (err) {
    console.error('Error deleting dashboard:', err);
    return errors.internal('Failed to delete dashboard');
  }
}
