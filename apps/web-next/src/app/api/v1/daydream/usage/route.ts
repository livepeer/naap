/**
 * Daydream Usage API Route
 * GET /api/v1/daydream/usage - Get usage statistics
 */

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { validateSession } from '@/lib/api/auth';
import { success, errors, getAuthToken } from '@/lib/api/response';

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

    // Get usage stats
    const [totalSessions, activeSessions, sessions] = await Promise.all([
      prisma.daydreamSession.count({
        where: { userId: user.id },
      }),
      prisma.daydreamSession.count({
        where: { userId: user.id, status: 'active' },
      }),
      prisma.daydreamSession.findMany({
        where: {
          userId: user.id,
          status: 'ended',
          durationMins: { not: null },
        },
        select: { durationMins: true },
      }),
    ]);

    const totalMinutes = sessions.reduce(
      (sum, s) => sum + (s.durationMins || 0),
      0
    );

    return success({
      totalSessions,
      activeSessions,
      totalMinutes: Math.round(totalMinutes * 100) / 100,
      averageSessionMinutes:
        sessions.length > 0
          ? Math.round((totalMinutes / sessions.length) * 100) / 100
          : 0,
    });
  } catch (err) {
    console.error('Error getting usage stats:', err);
    return errors.internal('Failed to get usage stats');
  }
}
