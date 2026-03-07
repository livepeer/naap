/**
 * Snapshot all user positions to WalletStakingSnapshot
 * Runs periodically via cron or on-demand via Sync Now
 */

import { prisma } from '../db/client.js';
import { getProtocolParams } from '../lib/protocolService.js';

export async function snapshotStaking(userId?: string): Promise<number> {
  const params = await getProtocolParams();
  const currentRound = params.currentRound;

  const whereClause = userId
    ? { userId, stakingStates: { some: {} } }
    : { stakingStates: { some: {} } };

  const addresses = await prisma.walletAddress.findMany({
    where: whereClause,
    include: { stakingStates: true },
  });

  let count = 0;

  for (const addr of addresses) {
    for (const state of addr.stakingStates) {
      // Skip if we already have a snapshot for this round
      const existing = await prisma.walletStakingSnapshot.findFirst({
        where: {
          walletAddressId: addr.id,
          orchestratorAddr: state.delegatedTo || '',
          round: currentRound,
        },
      });
      if (existing) continue;

      await prisma.walletStakingSnapshot.create({
        data: {
          walletAddressId: addr.id,
          orchestratorAddr: state.delegatedTo || '',
          bondedAmount: state.stakedAmount || '0',
          pendingStake: state.pendingRewards || '0',
          pendingFees: state.pendingFees || '0',
          round: currentRound,
        },
      });
      count++;
    }
  }

  console.log(`[snapshot] Created ${count} snapshots for round ${currentRound}`);
  return count;
}
