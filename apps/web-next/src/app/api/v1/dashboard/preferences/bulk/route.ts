/**
 * Dashboard Preferences Bulk Update API Route
 * PUT /api/v1/dashboard/preferences/bulk - Bulk update preferences (reorder / pin)
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { validateSession } from '@/lib/api/auth';
import { success, errors, getAuthToken } from '@/lib/api/response';
import { validateCSRF } from '@/lib/api/csrf';

export async function PUT(request: NextRequest): Promise<NextResponse> {
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
    const { preferences } = body;

    if (!Array.isArray(preferences)) {
      return errors.badRequest('preferences array is required');
    }

    // Update each preference in a transaction
    await prisma.$transaction(
      preferences.map((pref: { dashboardId: string; order: number; pinned?: boolean }) =>
        prisma.dashboardUserPreference.upsert({
          where: {
            userId_dashboardId: { userId: user.id, dashboardId: pref.dashboardId },
          },
          update: {
            order: pref.order,
            ...(pref.pinned !== undefined && { pinned: pref.pinned }),
          },
          create: {
            userId: user.id,
            dashboardId: pref.dashboardId,
            order: pref.order,
            pinned: pref.pinned ?? true,
          },
        }),
      ),
    );

    return success({ updated: preferences.length });
  } catch (err) {
    console.error('Error bulk updating preferences:', err);
    return errors.internal('Failed to update preferences');
  }
}
