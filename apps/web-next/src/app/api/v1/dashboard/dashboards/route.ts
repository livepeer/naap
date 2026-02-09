/**
 * Dashboard API Routes
 * GET /api/v1/dashboard/dashboards - List dashboards
 * POST /api/v1/dashboard/dashboards - Create dashboard
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

    const dashboards = await prisma.dashboard.findMany({
      orderBy: [
        { isDefault: 'desc' },
        { order: 'asc' },
        { name: 'asc' },
      ],
    });

    return success({
      dashboards,
      total: dashboards.length,
    });
  } catch (err) {
    console.error('Error fetching dashboards:', err);
    return errors.internal('Failed to fetch dashboards');
  }
}

export async function POST(request: NextRequest) {
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
    const { metabaseId, entityId, name, description, thumbnail, isDefault } = body;

    if (!metabaseId || !name) {
      return errors.badRequest('metabaseId and name are required');
    }

    const numericId = parseInt(metabaseId);
    if (isNaN(numericId)) {
      return errors.badRequest('metabaseId must be a numeric ID');
    }

    const dashboard = await prisma.dashboard.create({
      data: {
        metabaseId: numericId,
        entityId: entityId || null,
        name,
        description: description || null,
        thumbnail: thumbnail || null,
        isDefault: isDefault || false,
        createdBy: user.id,
      },
    });

    return success({ dashboard });
  } catch (err) {
    console.error('Error creating dashboard:', err);
    return errors.internal('Failed to create dashboard');
  }
}
