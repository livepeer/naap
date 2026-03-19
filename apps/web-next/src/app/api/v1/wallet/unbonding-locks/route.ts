/**
 * Unbonding Locks API Route
 * GET /api/v1/wallet/unbonding-locks - Get all unbonding locks for current user
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

    const locks = await prisma.walletUnbondingLock.findMany({
      where: {
        walletAddress: { userId: user.id },
      },
      include: {
        walletAddress: {
          select: { address: true, label: true, chainId: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return success({ locks });
  } catch (err) {
    console.error('Error fetching unbonding locks:', err);
    return errors.internal('Failed to fetch unbonding locks');
  }
}
