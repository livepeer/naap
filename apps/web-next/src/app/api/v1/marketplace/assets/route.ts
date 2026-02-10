/**
 * Marketplace Assets API Route
 * GET /api/v1/marketplace/assets - List marketplace assets (plugin packages)
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { success, errors, parsePagination } from '@/lib/api/response';

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const searchParams = request.nextUrl.searchParams;
    const { page, pageSize, skip } = parsePagination(searchParams);
    const category = searchParams.get('category');
    const search = searchParams.get('search');
    const sort = searchParams.get('sort') || 'name';

    // Build query filter
    const where: Record<string, unknown> = {
      publishStatus: 'published',
      deprecated: false,
    };

    if (category && category !== 'all') {
      where.category = category;
    }

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { displayName: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
      ];
    }

    // Determine sort order
    let orderBy: Record<string, string> = { name: 'asc' };
    switch (sort) {
      case 'downloads':
        orderBy = { downloads: 'desc' };
        break;
      case 'rating':
        orderBy = { rating: 'desc' };
        break;
      case 'newest':
        orderBy = { createdAt: 'desc' };
        break;
      default:
        orderBy = { name: 'asc' };
    }

    const [assets, total] = await Promise.all([
      prisma.pluginPackage.findMany({
        where,
        orderBy,
        take: pageSize,
        skip,
        include: {
          versions: {
            orderBy: { publishedAt: 'desc' },
            take: 1,
          },
        },
      }),
      prisma.pluginPackage.count({ where }),
    ]);

    const formatted = assets.map((pkg) => ({
      id: pkg.id,
      name: pkg.name,
      displayName: pkg.displayName,
      description: pkg.description,
      category: pkg.category,
      author: pkg.author,
      icon: pkg.icon,
      downloads: pkg.downloads,
      rating: pkg.rating,
      latestVersion: pkg.versions[0]?.version || null,
      status: pkg.publishStatus,
      createdAt: pkg.createdAt.toISOString(),
    }));

    return success(
      { assets: formatted },
      {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    );
  } catch (err) {
    console.error('Error listing marketplace assets:', err);
    return errors.internal('Failed to list marketplace assets');
  }
}
