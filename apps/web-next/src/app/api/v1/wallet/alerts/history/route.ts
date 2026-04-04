/**
 * Alert History API
 * GET /api/v1/wallet/alerts/history - Paginated alert history
 */

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { validateSession } from '@/lib/api/auth';
import { success, errors, getAuthToken } from '@/lib/api/response';

export async function GET(request: NextRequest) {
  try {
    const token = getAuthToken(request);
    if (!token) return errors.unauthorized('No auth token provided');
    const user = await validateSession(token);
    if (!user) return errors.unauthorized('Invalid or expired session');

    const limit = parseInt(request.nextUrl.searchParams.get('limit') || '50', 10);
    const offset = parseInt(request.nextUrl.searchParams.get('offset') || '0', 10);

    const alerts = await prisma.walletAlert.findMany({
      where: { userId: user.id },
      select: { id: true },
    });
    const alertIds = alerts.map(a => a.id);

    const [items, total] = await Promise.all([
      prisma.walletAlertHistory.findMany({
        where: { alertId: { in: alertIds } },
        include: { alert: { select: { type: true, orchestratorAddr: true } } },
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      prisma.walletAlertHistory.count({ where: { alertId: { in: alertIds } } }),
    ]);

    return success({ items, total });
  } catch (err) {
    console.error('Error fetching alert history:', err);
    return errors.internal('Failed to fetch alert history');
  }
}
