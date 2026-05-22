/**
 * Alerts API Routes
 * GET /api/v1/wallet/alerts - List user alerts
 * POST /api/v1/wallet/alerts - Create alert
 */

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { validateSession } from '@/lib/api/auth';
import { success, errors, getAuthToken } from '@/lib/api/response';
import { validateCSRF } from '@/lib/api/csrf';

const VALID_TYPES = ['reward_cut_change', 'missed_reward', 'deactivation', 'unbonding_ready'];

export async function GET(request: NextRequest) {
  try {
    const token = getAuthToken(request);
    if (!token) return errors.unauthorized('No auth token provided');
    const user = await validateSession(token);
    if (!user) return errors.unauthorized('Invalid or expired session');

    const alerts = await prisma.walletAlert.findMany({
      where: { userId: user.id },
      include: { history: { orderBy: { createdAt: 'desc' }, take: 5 } },
      orderBy: { createdAt: 'desc' },
    });

    const unreadCount = await prisma.walletAlertHistory.count({
      where: { alertId: { in: alerts.map(a => a.id) }, readAt: null },
    });

    return success({ alerts, unreadCount });
  } catch (err) {
    console.error('Error fetching alerts:', err);
    return errors.internal('Failed to fetch alerts');
  }
}

export async function POST(request: NextRequest) {
  try {
    const token = getAuthToken(request);
    if (!token) return errors.unauthorized('No auth token provided');
    const csrfError = validateCSRF(request, { shadowMode: true });
    if (csrfError) return csrfError;
    const user = await validateSession(token);
    if (!user) return errors.unauthorized('Invalid or expired session');

    const { type, orchestratorAddr, threshold, enabled } = await request.json();
    if (!type || !VALID_TYPES.includes(type)) {
      return errors.badRequest(`type must be one of: ${VALID_TYPES.join(', ')}`);
    }

    const alert = await prisma.walletAlert.create({
      data: {
        userId: user.id,
        type,
        orchestratorAddr: orchestratorAddr || null,
        threshold: threshold ? JSON.stringify(threshold) : null,
        enabled: enabled ?? true,
      },
    });

    return success({ alert });
  } catch (err) {
    console.error('Error creating alert:', err);
    return errors.internal('Failed to create alert');
  }
}
