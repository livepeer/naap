/**
 * Vercel Cron trigger for staking snapshot
 * Protected by CRON_SECRET
 */

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { success, errors } from '@/lib/api/response';

export async function GET(request: NextRequest) {
  const secret = request.headers.get('authorization')?.replace('Bearer ', '');
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return errors.internal('Cron secret not configured');
  if (secret !== cronSecret) return errors.unauthorized('Invalid cron secret');

  try {
    const addresses = await prisma.walletAddress.findMany({
      where: { stakingStates: { some: {} } },
      include: { stakingStates: true },
    });

    let count = 0;
    for (const addr of addresses) {
      for (const state of addr.stakingStates) {
        await prisma.walletStakingSnapshot.create({
          data: {
            walletAddressId: addr.id,
            orchestratorAddr: state.delegatedTo || '',
            bondedAmount: state.stakedAmount || '0',
            pendingStake: state.pendingRewards || '0',
            pendingFees: state.pendingFees || '0',
            round: 0,
          },
        });
        count++;
      }
    }

    return success({ snapshots: count });
  } catch (err) {
    console.error('Cron snapshot error:', err);
    return errors.internal('Snapshot job failed');
  }
}
