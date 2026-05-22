/**
 * Watchlist entry management (S15)
 */

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { validateSession } from '@/lib/api/auth';
import { success, errors, getAuthToken } from '@/lib/api/response';
import { validateCSRF } from '@/lib/api/csrf';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const token = getAuthToken(request);
    if (!token) return errors.unauthorized('No auth token provided');
    const csrfError = validateCSRF(request, { shadowMode: true });
    if (csrfError) return csrfError;
    const user = await validateSession(token);
    if (!user) return errors.unauthorized('Invalid or expired session');

    const { id } = await params;
    const body = await request.json();
    const entry = await prisma.walletWatchlist.findFirst({ where: { id, userId: user.id } });
    if (!entry) return errors.notFound('Watchlist entry not found');

    const updated = await prisma.walletWatchlist.update({
      where: { id },
      data: {
        ...(body.label !== undefined && { label: body.label }),
        ...(body.notes !== undefined && { notes: body.notes }),
      },
    });

    return success(updated);
  } catch (err) {
    console.error('Watchlist update error:', err);
    return errors.internal('Failed to update watchlist entry');
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const token = getAuthToken(request);
    if (!token) return errors.unauthorized('No auth token provided');
    const csrfError = validateCSRF(request, { shadowMode: true });
    if (csrfError) return csrfError;
    const user = await validateSession(token);
    if (!user) return errors.unauthorized('Invalid or expired session');

    const { id } = await params;
    const entry = await prisma.walletWatchlist.findFirst({ where: { id, userId: user.id } });
    if (!entry) return errors.notFound('Watchlist entry not found');

    await prisma.walletWatchlist.delete({ where: { id } });
    return success({ deleted: true });
  } catch (err) {
    console.error('Watchlist delete error:', err);
    return errors.internal('Failed to remove from watchlist');
  }
}
