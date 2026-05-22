/**
 * Sync Now API - On-demand sync for current user
 * POST /api/v1/wallet/sync
 */

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { validateSession } from '@/lib/api/auth';
import { success, errors, getAuthToken } from '@/lib/api/response';
import { validateCSRF } from '@/lib/api/csrf';

export async function POST(request: NextRequest) {
  try {
    const token = getAuthToken(request);
    if (!token) return errors.unauthorized('No auth token provided');
    const csrfError = validateCSRF(request, { shadowMode: true });
    if (csrfError) return csrfError;
    const user = await validateSession(token);
    if (!user) return errors.unauthorized('Invalid or expired session');

    const addresses = await prisma.walletAddress.findMany({
      where: { userId: user.id },
    });

    const addrStrings = addresses.map(a => a.address);
    const stakingStates = await prisma.walletStakingState.findMany({
      where: { address: { in: addrStrings } },
    });

    let snapshotCount = 0;
    for (const state of stakingStates) {
      await prisma.walletStakingSnapshot.create({
        data: {
          address: state.address,
          orchestrator: state.delegatedTo || '',
          bondedAmount: state.stakedAmount || '0',
          pendingStake: state.pendingRewards || '0',
          pendingFees: state.pendingFees || '0',
          round: 0,
        },
      });
      snapshotCount++;
    }

    return success({ synced: true, snapshotCount });
  } catch (err) {
    console.error('Error syncing:', err);
    return errors.internal('Failed to sync');
  }
}
