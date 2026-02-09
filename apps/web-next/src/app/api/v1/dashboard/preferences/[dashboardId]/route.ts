/**
 * Dashboard Preference by Dashboard ID API Route
 * DELETE /api/v1/dashboard/preferences/:dashboardId - Remove a preference
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { validateSession } from '@/lib/api/auth';
import { success, errors, getAuthToken } from '@/lib/api/response';
import { validateCSRF } from '@/lib/api/csrf';

interface RouteParams {
  params: Promise<{ dashboardId: string }>;
}

export async function DELETE(request: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  try {
    const { dashboardId } = await params;

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

    await prisma.dashboardUserPreference.delete({
      where: {
        userId_dashboardId: { userId: user.id, dashboardId },
      },
    });

    return success({ deleted: true });
  } catch (err) {
    console.error('Error deleting preference:', err);
    return errors.internal('Failed to delete preference');
  }
}
