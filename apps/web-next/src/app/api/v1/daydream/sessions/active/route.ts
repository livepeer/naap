/**
 * Active Daydream Session API Routes
 * GET /api/v1/daydream/sessions/active - Get active session
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

    const session = await prisma.daydreamSession.findFirst({
      where: {
        userId: user.id,
        status: 'active',
      },
      orderBy: { startedAt: 'desc' },
    });

    return success({ session });
  } catch (err) {
    console.error('Error getting active session:', err);
    return errors.internal('Failed to get active session');
  }
}
