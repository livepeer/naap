import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { success, errors } from '@/lib/api/response';

// GET /api/v1/base/user/preferences - Get user plugin preferences
export async function GET(request: NextRequest) {
  try {
    const userId = request.nextUrl.searchParams.get('userId');

    if (!userId) {
      return errors.badRequest('User ID is required');
    }

    const preferences = await prisma.userPluginPreference.findMany({
      where: { userId },
      orderBy: { order: 'asc' },
    });

    return success({
      preferences: preferences.map(p => ({
        pluginName: p.pluginName,
        enabled: p.enabled,
        pinned: p.pinned,
        order: p.order,
      })),
    });
  } catch (err) {
    console.error('Error fetching user preferences:', err);
    return errors.internal('Failed to fetch preferences');
  }
}

// POST /api/v1/base/user/preferences - Save user plugin preference
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { userId, pluginName, enabled, pinned, order } = body;

    if (!userId || !pluginName) {
      return errors.badRequest('User ID and plugin name are required');
    }

    // Upsert the preference
    const preference = await prisma.userPluginPreference.upsert({
      where: {
        userId_pluginName: {
          userId,
          pluginName,
        },
      },
      update: {
        enabled: enabled ?? true,
        pinned: pinned ?? false,
        order: order ?? 100,
      },
      create: {
        userId,
        pluginName,
        enabled: enabled ?? true,
        pinned: pinned ?? false,
        order: order ?? 100,
      },
    });

    return success({ preference });
  } catch (err) {
    console.error('Error saving user preference:', err);
    return errors.internal('Failed to save preference');
  }
}
