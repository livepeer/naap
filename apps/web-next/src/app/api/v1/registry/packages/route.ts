/**
 * Plugin Registry Packages API Route
 * GET /api/v1/registry/packages - List available plugin packages
 *
 * Ports legacy base-svc registry endpoint to Next.js.
 */

import {NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { validateSession } from '@/lib/api/auth';
import { success, errors, parsePagination, getAuthToken } from '@/lib/api/response';

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const searchParams = request.nextUrl.searchParams;
    const search = searchParams.get('search');
    const category = searchParams.get('category');
    const sort = searchParams.get('sort') || 'downloads';
    const { page, pageSize, skip } = parsePagination(searchParams);

    // Determine admin status + session user for visibility filtering
    let isAdmin = false;
    let sessionUserId: string | null = null;
    const token = getAuthToken(request);
    if (token) {
      const sessionUser = await validateSession(token);
      if (sessionUser) {
        isAdmin = sessionUser.roles?.includes('system:admin') ?? false;
        sessionUserId = sessionUser.id;
      }
    }

    const andParts: Record<string, unknown>[] = [
      { deprecated: false },
      { publishStatus: 'published' },
    ];

    if (!isAdmin) {
      if (sessionUserId) {
        andParts.push({
          OR: [
            { visibleToUsers: true },
            { previewTesterUserIds: { has: sessionUserId } },
          ],
        });
      } else {
        andParts.push({ visibleToUsers: true });
      }
    }

    if (category && category !== 'all') {
      andParts.push({ category });
    }

    if (search) {
      andParts.push({
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { displayName: { contains: search, mode: 'insensitive' } },
          { description: { contains: search, mode: 'insensitive' } },
          { keywords: { has: search } },
        ],
      });
    }

    const where = { AND: andParts };

    const orderBy: any = {};
    if (sort === 'downloads') orderBy.downloads = 'desc';
    else if (sort === 'rating') orderBy.rating = 'desc';
    else if (sort === 'newest') orderBy.createdAt = 'desc';
    else if (sort === 'name') orderBy.name = 'asc';

    const [packages, total] = await Promise.all([
      prisma.pluginPackage.findMany({
        where,
        orderBy,
        take: pageSize,
        skip,
        include: {
          versions: {
            where: { deprecated: false },
            orderBy: { publishedAt: 'desc' },
            take: 1,
          },
        },
      }),
      prisma.pluginPackage.count({ where }),
    ]);

    return success(
      { packages },
      { page, pageSize, total, totalPages: Math.ceil(total / pageSize) }
    );
  } catch (err) {
    console.error('Error fetching registry packages:', err);
    return errors.internal('Failed to fetch registry packages');
  }
}
