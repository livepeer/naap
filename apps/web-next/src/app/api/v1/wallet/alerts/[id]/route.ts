/**
 * Alert CRUD by ID
 * PATCH /api/v1/wallet/alerts/[id] - Update alert
 * DELETE /api/v1/wallet/alerts/[id] - Delete alert
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
    const existing = await prisma.walletAlert.findFirst({ where: { id, userId: user.id } });
    if (!existing) return errors.notFound('Alert not found');

    const body = await request.json();
    const alert = await prisma.walletAlert.update({
      where: { id },
      data: {
        ...(body.type !== undefined && { type: body.type }),
        ...(body.orchestratorAddr !== undefined && { orchestratorAddr: body.orchestratorAddr }),
        ...(body.threshold !== undefined && { threshold: JSON.stringify(body.threshold) }),
        ...(body.enabled !== undefined && { enabled: body.enabled }),
      },
    });

    return success({ alert });
  } catch (err) {
    console.error('Error updating alert:', err);
    return errors.internal('Failed to update alert');
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const token = getAuthToken(request);
    if (!token) return errors.unauthorized('No auth token provided');
    const csrfError = validateCSRF(request, { shadowMode: true });
    if (csrfError) return csrfError;
    const user = await validateSession(token);
    if (!user) return errors.unauthorized('Invalid or expired session');

    const { id } = await params;
    const existing = await prisma.walletAlert.findFirst({ where: { id, userId: user.id } });
    if (!existing) return errors.notFound('Alert not found');

    await prisma.walletAlert.delete({ where: { id } });
    return success({ deleted: true });
  } catch (err) {
    console.error('Error deleting alert:', err);
    return errors.internal('Failed to delete alert');
  }
}
