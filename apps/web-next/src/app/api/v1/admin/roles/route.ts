/**
 * GET /api/v1/admin/roles
 * List all assignable roles (admin only).
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { validateSession } from '@/lib/api/auth';
import { success, errors, getAuthToken } from '@/lib/api/response';

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const token = getAuthToken(request);
    if (!token) return errors.unauthorized('No auth token provided');

    const sessionUser = await validateSession(token);
    if (!sessionUser) return errors.unauthorized('Invalid or expired session');
    if (!sessionUser.roles.includes('system:admin')) {
      return errors.forbidden('Admin permission required');
    }

    const roles = await prisma.role.findMany({
      where: { name: { not: 'system:root' } },
      select: {
        id: true,
        name: true,
        displayName: true,
        scope: true,
      },
      orderBy: { name: 'asc' },
    });

    return success({ roles });
  } catch (err) {
    console.error('Error fetching roles:', err);
    return errors.internal('Failed to fetch roles');
  }
}
