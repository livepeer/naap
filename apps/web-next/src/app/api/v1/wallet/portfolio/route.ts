/**
 * Portfolio API Route
 * GET /api/v1/wallet/portfolio - Get aggregated portfolio across all wallet addresses
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
      orderBy: [{ isPrimary: 'desc' }, { connectedAt: 'asc' }],
    });

    const addrStrings = addresses.map(a => a.address);
    const stakingStates = await prisma.walletStakingState.findMany({
      where: { address: { in: addrStrings } },
    });

    let totalStaked = 0n;
    let totalPendingRewards = 0n;
    let totalPendingFees = 0n;

    for (const state of stakingStates) {
      totalStaked += BigInt(state.stakedAmount || '0');
      totalPendingRewards += BigInt(state.pendingRewards || '0');
      totalPendingFees += BigInt(state.pendingFees || '0');
    }

    return success({
      portfolio: {
        totalStaked: totalStaked.toString(),
        totalPendingRewards: totalPendingRewards.toString(),
        totalPendingFees: totalPendingFees.toString(),
        addressCount: addresses.length,
      },
    });
  } catch (err) {
    console.error('Error fetching portfolio:', err);
    return errors.internal('Failed to fetch portfolio');
  }
}
