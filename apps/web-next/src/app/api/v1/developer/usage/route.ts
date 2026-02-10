/**
 * Developer API Usage Stats Route
 * GET /api/v1/developer/usage - Get API usage statistics for the authenticated user
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { validateSession } from '@/lib/api/auth';
import { success, errors, getAuthToken } from '@/lib/api/response';

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const token = getAuthToken(request);
    if (!token) {
      return errors.unauthorized('No auth token provided');
    }

    const user = await validateSession(token);
    if (!user) {
      return errors.unauthorized('Invalid or expired session');
    }

    // Fetch all API keys for this user, including usage logs
    const keys = await prisma.devApiKey.findMany({
      where: { userId: user.id },
      include: { usageLogs: true },
    });

    const totalRequests = keys.reduce(
      (sum, k) => sum + k.usageLogs.reduce((s, l) => s + l.requestCount, 0),
      0,
    );

    const totalCost = keys.reduce(
      (sum, k) => sum + k.usageLogs.reduce((s, l) => s + l.costIncurred, 0),
      0,
    );

    return success({
      totalKeys: keys.length,
      activeKeys: keys.filter((k) => k.status === 'ACTIVE').length,
      totalRequests,
      totalCost: totalCost.toFixed(4),
    });
  } catch (err) {
    console.error('Error fetching usage stats:', err);
    return errors.internal('Failed to fetch usage statistics');
  }
}
