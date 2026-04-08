/**
 * Vercel Cron trigger for staking snapshot
 * Protected by CRON_SECRET
 *
 * Appends one snapshot row per staking state per run (round = unix seconds)
 * so /api/v1/wallet/yield can chart over time. pendingStake = principal + rewards.
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

    const round = Math.floor(Date.now() / 1000);
    let count = 0;
    for (const state of states) {
      const addr = state.address.toLowerCase();
      const pendingStake = (
        BigInt(state.stakedAmount || '0') + BigInt(state.pendingRewards || '0')
      ).toString();

      try {
        await prisma.walletStakingSnapshot.create({
          data: {
            address: addr,
            orchestrator: state.delegatedTo ?? '',
            round,
            bondedAmount: state.stakedAmount,
            pendingStake,
            pendingFees: state.pendingFees,
          },
        });
        count++;
      } catch (e) {
        const code =
          typeof e === 'object' && e !== null && 'code' in e
            ? String((e as { code: unknown }).code)
            : '';
        if (code === 'P2002') continue;
        throw e;
      }
    }

    return success({ snapshots: count });
  } catch (err) {
    console.error('Cron snapshot error:', err);
    return errors.internal('Snapshot job failed');
  }
}
