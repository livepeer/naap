/**
 * Wallet Address by ID API Routes
 * PATCH /api/v1/wallet/addresses/[id] - Update wallet address (label, isPrimary)
 * DELETE /api/v1/wallet/addresses/[id] - Remove wallet address
 */

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { validateSession } from '@/lib/api/auth';
import { success, errors, getAuthToken } from '@/lib/api/response';
import { validateCSRF } from '@/lib/api/csrf';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const token = getAuthToken(request);
    if (!token) return errors.unauthorized('No auth token provided');

    const csrfError = validateCSRF(request, token);
    if (csrfError) return csrfError;

    const user = await validateSession(token);
    if (!user) return errors.unauthorized('Invalid or expired session');

    const { id } = await params;
    const body = await request.json();
    const { label, isPrimary } = body;

    // Verify ownership
    const addr = await prisma.walletAddress.findFirst({
      where: { id, userId: user.id },
    });
    if (!addr) return errors.notFound('Wallet address not found');

    // If setting as primary, unset other primaries first
    if (isPrimary) {
      await prisma.walletAddress.updateMany({
        where: { userId: user.id, isPrimary: true },
        data: { isPrimary: false },
      });
    }

    const updated = await prisma.walletAddress.update({
      where: { id },
      data: {
        ...(label !== undefined ? { label } : {}),
        ...(isPrimary !== undefined ? { isPrimary } : {}),
      },
    });

    return success({ address: updated });
  } catch (err) {
    console.error('Error updating wallet address:', err);
    return errors.internal('Failed to update wallet address');
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const token = getAuthToken(request);
    if (!token) return errors.unauthorized('No auth token provided');

    const csrfError = validateCSRF(request, token);
    if (csrfError) return csrfError;

    const user = await validateSession(token);
    if (!user) return errors.unauthorized('Invalid or expired session');

    const { id } = await params;

    // Verify ownership
    const addr = await prisma.walletAddress.findFirst({
      where: { id, userId: user.id },
    });
    if (!addr) return errors.notFound('Wallet address not found');

    await prisma.walletAddress.delete({ where: { id } });

    // If deleted was primary, promote the next one
    if (addr.isPrimary) {
      const next = await prisma.walletAddress.findFirst({
        where: { userId: user.id },
        orderBy: { connectedAt: 'asc' },
      });
      if (next) {
        await prisma.walletAddress.update({
          where: { id: next.id },
          data: { isPrimary: true },
        });
      }
    }

    return success({ deleted: true });
  } catch (err) {
    console.error('Error deleting wallet address:', err);
    return errors.internal('Failed to delete wallet address');
  }
}
