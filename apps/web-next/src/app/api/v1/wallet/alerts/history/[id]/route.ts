/**
 * Mark alert history item as read
 * PATCH /api/v1/wallet/alerts/history/[id]
 */

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { validateSession } from '@/lib/api/auth';
import { success, errors, getAuthToken } from '@/lib/api/response';
import { validateCSRF } from '@/lib/api/csrf';

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const token = getAuthToken(request);
    if (!token) return errors.unauthorized('No auth token provided');
    const csrfError = validateCSRF(request, { shadowMode: true });
    if (csrfError) return csrfError;
    const user = await validateSession(token);
    if (!user) return errors.unauthorized('Invalid or expired session');

    const { id } = await params;
    const item = await prisma.walletAlertHistory.findFirst({
      where: { id },
      include: { alert: true },
    });

    if (!item || item.alert.userId !== user.id) {
      return errors.notFound('Alert history item not found');
    }

    const updated = await prisma.walletAlertHistory.update({
      where: { id },
      data: { readAt: new Date() },
    });

    return success({ item: updated });
  } catch (err) {
    console.error('Error marking alert read:', err);
    return errors.internal('Failed to mark alert as read');
  }
}
