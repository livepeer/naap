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

    const addresses = await prisma.walletAddress.findMany({
      where: { userId: user.id },
      select: { address: true, label: true, chainId: true },
    });

    const addrStrings = addresses.map(a => a.address);
    const locks = await prisma.walletUnbondingLock.findMany({
      where: { address: { in: addrStrings } },
      orderBy: { createdAt: 'desc' },
    });

    const addrMap = new Map(addresses.map(a => [a.address, a]));
    const enrichedLocks = locks.map(lock => ({
      ...lock,
      walletAddress: addrMap.get(lock.address) || { address: lock.address, label: null, chainId: 42161 },
    }));

    return success({ locks: enrichedLocks });
  } catch (err) {
    console.error('Error fetching unbonding locks:', err);
    return errors.internal('Failed to fetch unbonding locks');
  }
}
