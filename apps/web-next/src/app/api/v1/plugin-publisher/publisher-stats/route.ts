/**
 * Publisher Stats Endpoint
 * GET /api/v1/plugin-publisher/publisher-stats - Get publisher's overall statistics
 */

import { NextRequest } from 'next/server';
import { validateSession } from '@/lib/api/auth';
import { success, errors, getAuthToken } from '@/lib/api/response';

const BASE_SVC_URL = process.env.BASE_SVC_URL || 'http://localhost:4000';

interface Package {
  publishStatus: string;
  downloads: number;
  rating?: number;
}

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

    // Fetch publisher's packages from base-svc
    const response = await fetch(`${BASE_SVC_URL}/api/v1/registry/packages?mine=true`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      return errors.internal('Failed to fetch packages');
    }

    const data = await response.json();
    const packages: Package[] = data.packages || [];

    const stats = {
      totalPlugins: packages.length,
      publishedCount: packages.filter(p => p.publishStatus === 'published').length,
      totalDownloads: packages.reduce((sum, p) => sum + (p.downloads || 0), 0),
      avgRating: packages.length > 0
        ? packages.reduce((sum, p) => sum + (p.rating || 0), 0) / packages.length
        : 0,
    };

    return success(stats);
  } catch (err) {
    console.error('Publisher stats error:', err);
    return errors.internal('Failed to fetch publisher stats');
  }
}
