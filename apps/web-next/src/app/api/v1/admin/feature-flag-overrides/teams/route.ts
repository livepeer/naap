/**
 * Admin teams list for the per-team feature-flag override UI (admin only).
 *
 *   GET /api/v1/admin/feature-flag-overrides/teams[?q=search]
 *     → teams (id, name, slug) with a count of active overrides, so the admin can
 *       pick a team to manage. Search is a case-insensitive name/slug contains.
 *
 * Read-only; guarded by the existing `system:admin` authz.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { validateSession } from '@/lib/api/auth';
import { success, errors, getAuthToken } from '@/lib/api/response';

const MAX_TEAMS = 200;

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const token = getAuthToken(request);
    if (!token) return errors.unauthorized('No auth token provided');

    const sessionUser = await validateSession(token);
    if (!sessionUser) return errors.unauthorized('Invalid or expired session');
    if (!sessionUser.roles.includes('system:admin')) {
      return errors.forbidden('Admin permission required');
    }

    const q = request.nextUrl.searchParams.get('q')?.trim();
    const where = q
      ? {
          OR: [
            { name: { contains: q, mode: 'insensitive' as const } },
            { slug: { contains: q, mode: 'insensitive' as const } },
          ],
        }
      : {};

    const teams = await prisma.team.findMany({
      where,
      select: {
        id: true,
        name: true,
        slug: true,
        _count: { select: { featureFlagOverrides: true } },
      },
      orderBy: { name: 'asc' },
      take: MAX_TEAMS,
    });

    return success({
      teams: teams.map((t) => ({
        id: t.id,
        name: t.name,
        slug: t.slug,
        overrideCount: t._count.featureFlagOverrides,
      })),
    });
  } catch (err) {
    console.error('Error listing teams for feature flag overrides:', err);
    return errors.internal('Failed to list teams');
  }
}
