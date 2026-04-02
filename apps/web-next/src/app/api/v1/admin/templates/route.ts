/**
 * Admin Gateway Templates Visibility API
 *
 * GET  /api/v1/admin/templates - List all templates with visibleToUsers status
 * PUT  /api/v1/admin/templates - Update which templates are visible to non-admin users
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { validateSession } from '@/lib/api/auth';
import { success, errors, getAuthToken } from '@/lib/api/response';

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const token = getAuthToken(request);
    if (!token) {
      return errors.unauthorized('Authentication required');
    }

    const sessionUser = await validateSession(token);
    if (!sessionUser) {
      return errors.unauthorized('Invalid session');
    }

    if (!sessionUser.roles.includes('system:admin')) {
      return errors.forbidden('Admin permission required');
    }

    const templates = await prisma.gatewayConnectorTemplate.findMany({
      select: {
        id: true,
        name: true,
        description: true,
        icon: true,
        category: true,
        visibleToUsers: true,
      },
      orderBy: { name: 'asc' },
    });

    return success({ templates });
  } catch (err) {
    console.error('Error fetching admin templates:', err);
    return errors.internal('Failed to fetch templates');
  }
}

export async function PUT(request: NextRequest): Promise<NextResponse> {
  try {
    const token = getAuthToken(request);
    if (!token) {
      return errors.unauthorized('Authentication required');
    }

    const sessionUser = await validateSession(token);
    if (!sessionUser) {
      return errors.unauthorized('Invalid session');
    }

    if (!sessionUser.roles.includes('system:admin')) {
      return errors.forbidden('Admin permission required');
    }

    const body = await request.json();
    const { hiddenTemplateIds } = body as { hiddenTemplateIds: string[] };

    if (!Array.isArray(hiddenTemplateIds)) {
      return errors.badRequest('hiddenTemplateIds must be an array of template IDs');
    }

    await prisma.$transaction([
      prisma.gatewayConnectorTemplate.updateMany({
        data: { visibleToUsers: true },
      }),
      ...(hiddenTemplateIds.length > 0
        ? [
            prisma.gatewayConnectorTemplate.updateMany({
              where: { id: { in: hiddenTemplateIds } },
              data: { visibleToUsers: false },
            }),
          ]
        : []),
    ]);

    const updated = await prisma.gatewayConnectorTemplate.findMany({
      select: {
        id: true,
        name: true,
        description: true,
        icon: true,
        category: true,
        visibleToUsers: true,
      },
      orderBy: { name: 'asc' },
    });

    return success({
      templates: updated,
      message: `Template visibility updated. ${hiddenTemplateIds.length} template(s) hidden.`,
    });
  } catch (err) {
    console.error('Error updating template visibility:', err);
    return errors.internal('Failed to update template visibility');
  }
}
