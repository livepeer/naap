/**
 * Marketplace Asset Detail API Route
 * GET /api/v1/marketplace/assets/:id - Get a single marketplace asset
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { success, errors } from '@/lib/api/response';

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(_request: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  try {
    const { id } = await params;

    const pkg = await prisma.pluginPackage.findUnique({
      where: { id },
      include: {
        versions: {
          orderBy: { publishedAt: 'desc' },
        },
        deployment: true,
        reviews: {
          orderBy: { createdAt: 'desc' },
          take: 10,
        },
      },
    });

    if (!pkg) {
      return errors.notFound('Marketplace asset');
    }

    return success({
      id: pkg.id,
      name: pkg.name,
      displayName: pkg.displayName,
      description: pkg.description,
      category: pkg.category,
      author: pkg.author,
      authorEmail: pkg.authorEmail,
      repository: pkg.repository,
      license: pkg.license,
      keywords: pkg.keywords,
      icon: pkg.icon,
      downloads: pkg.downloads,
      rating: pkg.rating,
      status: pkg.publishStatus,
      versions: pkg.versions.map((v) => ({
        id: v.id,
        version: v.version,
        releaseNotes: v.releaseNotes,
        bundleUrl: v.bundleUrl,
        deploymentType: v.deploymentType,
        publishedAt: v.publishedAt.toISOString(),
      })),
      deployment: pkg.deployment
        ? {
            status: pkg.deployment.status,
            frontendUrl: pkg.deployment.frontendUrl,
            bundleUrl: pkg.deployment.bundleUrl,
            deploymentType: pkg.deployment.deploymentType,
            activeInstalls: pkg.deployment.activeInstalls,
            deployedAt: pkg.deployment.deployedAt?.toISOString() || null,
          }
        : null,
      reviews: pkg.reviews.map((r) => ({
        id: r.id,
        rating: r.rating,
        comment: r.comment,
        displayName: r.displayName,
        createdAt: r.createdAt.toISOString(),
      })),
      createdAt: pkg.createdAt.toISOString(),
      updatedAt: pkg.updatedAt.toISOString(),
    });
  } catch (err) {
    console.error('Error fetching marketplace asset:', err);
    return errors.internal('Failed to fetch marketplace asset');
  }
}
