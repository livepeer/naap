/**
 * Plugin Registry Package Detail API Route
 * GET  /api/v1/registry/packages/:name - Get package details by name
 * PUT  /api/v1/registry/packages/:name - Update package (owner or admin only)
 *
 * Ports legacy base-svc registry endpoint to Next.js.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { success, errors, getAuthToken } from '@/lib/api/response';
import { validateSession } from '@/lib/api/auth';

interface RouteParams {
  params: Promise<{ name: string }>;
}

/**
 * GET /api/v1/registry/packages/:name
 * Returns the package with all versions and installation counts.
 * Public endpoint — no auth required.
 */
export async function GET(
  _request: NextRequest,
  { params }: RouteParams
): Promise<NextResponse> {
  try {
    const { name } = await params;

    const pkg = await prisma.pluginPackage.findUnique({
      where: { name },
      include: {
        versions: {
          where: { deprecated: false },
          orderBy: { publishedAt: 'desc' },
        },
        _count: {
          select: { installations: true },
        },
      },
    });

    if (!pkg) {
      return errors.notFound('Package');
    }

    return success({
      package: {
        ...pkg,
        latestVersion: pkg.versions[0]?.version ?? null,
        installedCount: pkg._count.installations,
      },
    });
  } catch (err) {
    console.error('Error fetching package details:', err);
    return errors.internal('Failed to fetch package details');
  }
}

/**
 * PUT /api/v1/registry/packages/:name
 * Update package metadata. Requires authentication — only the package owner
 * or an admin can update.
 */
export async function PUT(
  request: NextRequest,
  { params }: RouteParams
): Promise<NextResponse> {
  try {
    const { name } = await params;

    // Authenticate
    const token = getAuthToken(request);
    if (!token) {
      return errors.unauthorized('No auth token provided');
    }

    const authUser = await validateSession(token);
    if (!authUser) {
      return errors.unauthorized('Invalid or expired session');
    }

    // Find the package
    const pkg = await prisma.pluginPackage.findUnique({
      where: { name },
      include: { publisher: true },
    });

    if (!pkg) {
      return errors.notFound('Package');
    }

    // Authorisation: admin or publisher owner
    const isAdmin =
      authUser.roles?.includes('system:admin') ||
      authUser.email === 'admin@livepeer.org';

    let hasAccess = false;
    if (!pkg.publisherId) hasAccess = true; // unowned package
    else if (isAdmin) hasAccess = true;
    else if (pkg.publisher && authUser.email && pkg.publisher.email === authUser.email) {
      hasAccess = true;
    } else {
      const userPublisher = await prisma.publisher.findFirst({
        where: { email: authUser.email || '' },
      });
      if (userPublisher && pkg.publisherId === userPublisher.id) hasAccess = true;
    }

    if (!hasAccess) {
      return errors.forbidden('You do not own this package');
    }

    // Parse body — only allow safe fields
    const body = await request.json();
    const allowedFields: Record<string, unknown> = {};
    if (body.displayName !== undefined) allowedFields.displayName = body.displayName;
    if (body.description !== undefined) allowedFields.description = body.description;
    if (body.category !== undefined) allowedFields.category = body.category;
    if (body.icon !== undefined) allowedFields.icon = body.icon;
    if (body.keywords !== undefined) allowedFields.keywords = body.keywords;
    if (body.repository !== undefined) allowedFields.repository = body.repository;

    if (Object.keys(allowedFields).length === 0) {
      return errors.badRequest('No updatable fields provided');
    }

    const updated = await prisma.pluginPackage.update({
      where: { name },
      data: allowedFields,
      include: {
        versions: {
          where: { deprecated: false },
          orderBy: { publishedAt: 'desc' },
        },
      },
    });

    return success({ package: updated });
  } catch (err) {
    console.error('Error updating package:', err);
    return errors.internal('Failed to update package');
  }
}
