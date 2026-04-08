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
    const states = await prisma.walletStakingState.findMany({
      where: {
        OR: [{ stakedAmount: { not: '0' } }, { delegatedTo: { not: null } }],
      },
    });

    let count = 0;
    for (const state of states) {
      const addr = state.address.toLowerCase();
      const round = Number.parseInt(state.startRound ?? '0', 10) || 0;
      await prisma.walletStakingSnapshot.upsert({
        where: {
          address_round: { address: addr, round },
        },
        create: {
          address: addr,
          orchestrator: state.delegatedTo ?? '',
          round,
          bondedAmount: state.stakedAmount,
          pendingStake: state.pendingRewards,
          pendingFees: state.pendingFees,
        },
        update: {
          orchestrator: state.delegatedTo ?? '',
          bondedAmount: state.stakedAmount,
          pendingStake: state.pendingRewards,
          pendingFees: state.pendingFees,
        },
      });
      count++;
    }

    return success({ snapshots: count });
  } catch (err) {
    console.error('Cron snapshot error:', err);
    return errors.internal('Snapshot job failed');
  }
}
