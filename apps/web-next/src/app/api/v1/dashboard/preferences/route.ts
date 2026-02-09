/**
 * Dashboard Preferences API Routes
 * GET /api/v1/dashboard/preferences - Get user's preferences
 * PUT /api/v1/dashboard/preferences - Update preferences
 */

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { validateSession } from '@/lib/api/auth';
import { success, errors, getAuthToken } from '@/lib/api/response';
import { validateCSRF } from '@/lib/api/csrf';

export async function GET(request: NextRequest) {
  try {
    const token = getAuthToken(request);
    if (!token) {
      return errors.unauthorized('No auth token provided');
    }

    const user = await validateSession(token);
    if (!user) {
      return errors.unauthorized('Invalid or expired session');
    }

    const preferences = await prisma.dashboardUserPreference.findMany({
      where: { userId: user.id },
      orderBy: { order: 'asc' },
    });

    return success({ preferences });
  } catch (err) {
    console.error('Error fetching preferences:', err);
    return errors.internal('Failed to fetch preferences');
  }
}

export async function PUT(request: NextRequest) {
  try {
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
    const { dashboardId, pinned, order } = body;

    if (!dashboardId) {
      return errors.badRequest('dashboardId is required');
    }

    const preference = await prisma.dashboardUserPreference.upsert({
      where: {
        userId_dashboardId: { userId: user.id, dashboardId },
      },
      update: {
        ...(pinned !== undefined && { pinned }),
        ...(order !== undefined && { order }),
      },
      create: {
        userId: user.id,
        dashboardId,
        pinned: pinned ?? true,
        order: order ?? 0,
      },
    });

    return success({ preference });
  } catch (err) {
    console.error('Error updating preferences:', err);
    return errors.internal('Failed to update preferences');
  }
}
