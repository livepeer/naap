/**
 * Plugin Stats Endpoint
 * GET /api/v1/plugin-publisher/stats/:packageName - Get plugin statistics from the database
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { validateSession } from '@/lib/api/auth';
import { success, errors, getAuthToken } from '@/lib/api/response';

/** Next.js 15 App Router passes params as a Promise. */
interface RouteParams {
  params: Promise<{ packageName: string }>;
}

export async function GET(request: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  try {
    const { packageName } = await params;

    const token = getAuthToken(request);
    if (!token) {
      return errors.unauthorized('No auth token provided');
    }

    const user = await validateSession(token);
    if (!user) {
      return errors.unauthorized('Invalid or expired session');
    }

    // Look up the package and its relations
    const pkg = await prisma.pluginPackage.findUnique({
      where: { name: packageName },
      include: {
        versions: {
          orderBy: { publishedAt: 'desc' },
          select: { id: true, version: true, publishedAt: true, downloads: true },
        },
        installations: {
          select: { installedAt: true },
        },
        _count: {
          select: { installations: true },
        },
      },
    });

    if (!pkg) {
      return errors.notFound('Package');
    }

    // Aggregate real download counts from versions
    const totalDownloads = pkg.versions.reduce((sum, v) => sum + (v.downloads ?? 0), 0);
    const totalInstalls = pkg._count.installations;
    const versionsCount = pkg.versions.length;

    // Build a 30-day installation timeline from real installation data
    const now = new Date();
    const thirtyDaysAgo = new Date(now);
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 29);
    thirtyDaysAgo.setHours(0, 0, 0, 0);

    // Create day buckets
    const timeline: { date: string; downloads: number; installs: number }[] = [];
    for (let i = 0; i < 30; i++) {
      const d = new Date(thirtyDaysAgo);
      d.setDate(d.getDate() + i);
      const y = d.getUTCFullYear();
      const m = String(d.getUTCMonth() + 1).padStart(2, '0');
      const day = String(d.getUTCDate()).padStart(2, '0');
      timeline.push({
        date: `${y}-${m}-${day}`,
        downloads: 0,
        installs: 0,
      });
    }

    // Bucket installations into days
    for (const inst of pkg.installations) {
      if (!inst.installedAt) continue;
      const instDate = new Date(inst.installedAt);
      if (instDate < thirtyDaysAgo) continue;
      const diffMs = instDate.getTime() - thirtyDaysAgo.getTime();
      const dayIndex = Math.min(29, Math.floor(diffMs / (24 * 60 * 60 * 1000)));
      timeline[dayIndex].installs += 1;
    }

    return success({
      totalDownloads,
      totalInstalls,
      versionsCount,
      timeline,
    });
  } catch (err) {
    console.error('Stats error:', err);
    return errors.internal('Failed to fetch stats');
  }
}
