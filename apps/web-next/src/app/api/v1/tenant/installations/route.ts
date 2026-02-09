import {NextRequest, NextResponse } from 'next/server';
import { success, errors } from '@/lib/api/response';

// Mock tenant installations for now
const MOCK_INSTALLATIONS = [
  {
    id: 'install-1',
    deployment: {
      package: { displayName: 'My Dashboard', icon: 'BarChart3' },
      version: { version: '1.2.0' },
      status: 'running',
    },
    config: {
      settings: {
        theme: 'dark',
        refreshInterval: 30,
      },
    },
  },
  {
    id: 'install-2',
    deployment: {
      package: { displayName: 'Community', icon: 'Users' },
      version: { version: '2.0.1' },
      status: 'running',
    },
    config: {
      settings: {
        maxPosts: 100,
        allowAnonymous: false,
      },
    },
  },
];

// GET /api/v1/tenant/installations - Get user's plugin installations
export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const userId = request.nextUrl.searchParams.get('userId');

    if (!userId) {
      return errors.badRequest('User ID is required');
    }

    // In production, fetch actual installations from database
    return success({
      installations: MOCK_INSTALLATIONS,
    });
  } catch (err) {
    console.error('Error fetching tenant installations:', err);
    return errors.internal('Failed to fetch installations');
  }
}
