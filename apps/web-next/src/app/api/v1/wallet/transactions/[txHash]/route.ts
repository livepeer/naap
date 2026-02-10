/**
 * Single Transaction API Routes
 * PATCH /api/v1/wallet/transactions/:txHash - Update transaction status
 */

import {NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { validateSession } from '@/lib/api/auth';
import { success, errors, getAuthToken } from '@/lib/api/response';
import { validateCSRF } from '@/lib/api/csrf';

const isValidTxHash = (hash: string): boolean => {
  return /^0x[a-fA-F0-9]{64}$/.test(hash);
};

const validStatuses = ['pending', 'confirmed', 'failed'];

interface RouteParams {
  params: Promise<{ txHash: string }>;
}

export async function PATCH(request: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  try {
    const { txHash } = await params;

    const token = getAuthToken(request);
    if (!token) {
      return errors.unauthorized('No auth token provided');
    }

    const csrfError = validateCSRF(request, token);
    if (csrfError) {
      return csrfError;
    }

    const user = await validateSession(token);
    if (!user) {
      return errors.unauthorized('Invalid or expired session');
    }

    if (!isValidTxHash(txHash)) {
      return errors.badRequest('Invalid transaction hash format');
    }

    const body = await request.json();
    const { status, blockNumber, gasUsed, confirmedAt } = body;

    if (status && !validStatuses.includes(status)) {
      return errors.badRequest(`Invalid status. Must be one of: ${validStatuses.join(', ')}`);
    }

    // Verify transaction belongs to user
    const existing = await prisma.walletTransactionLog.findFirst({
      where: { txHash, userId: user.id },
    });

    if (!existing) {
      return errors.notFound('Transaction');
    }

    const transaction = await prisma.walletTransactionLog.update({
      where: { txHash },
      data: {
        ...(status !== undefined && { status }),
        ...(blockNumber !== undefined && { blockNumber }),
        ...(gasUsed !== undefined && { gasUsed }),
        ...(confirmedAt !== undefined && { confirmedAt: new Date(confirmedAt) }),
      },
    });

    return success({ transaction });
  } catch (err: unknown) {
    const error = err as { code?: string };
    if (error.code === 'P2025') {
      return errors.notFound('Transaction');
    }
    console.error('Error updating transaction:', err);
    return errors.internal('Failed to update transaction');
  }
}
