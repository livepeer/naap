/**
 * Snapshot all tracked positions to WalletStakingSnapshot
 * Runs periodically via cron or on-demand via Sync Now
 *
 * Uses live Livepeer data (subgraph/RPC) + prices from CoinGecko.
 */

import { prisma } from '../db/client.js';
import { getDelegator, getProtocol, getPrices } from '../lib/livepeer.js';

export async function snapshotStaking(userId?: string): Promise<number> {
  const [protocol, prices] = await Promise.all([getProtocol(), getPrices()]);
  const currentRound = protocol.currentRound;

  // Find addresses to snapshot: either from a specific user's staking states or all known states
  const where: any = {};
  if (userId) where.address = userId.toLowerCase();
  const states = await prisma.walletStakingState.findMany({ where, select: { address: true } });

  let count = 0;

  for (const state of states) {
    try {
      const delegator = await getDelegator(state.address);
      if (!delegator || delegator.bondedAmount === '0' || !delegator.delegateAddress) continue;

      await prisma.walletStakingSnapshot.upsert({
        where: {
          address_round: {
            address: state.address.toLowerCase(),
            round: currentRound,
          },
        },
        update: {
          pendingStake: delegator.bondedAmount,
          pendingFees: delegator.fees || '0',
          lptPriceUsd: prices.lptUsd,
          ethPriceUsd: prices.ethUsd,
        },
        create: {
          address: state.address.toLowerCase(),
          orchestrator: delegator.delegateAddress,
          round: currentRound,
          bondedAmount: delegator.principal || '0',
          pendingStake: delegator.bondedAmount,
          pendingFees: delegator.fees || '0',
          lptPriceUsd: prices.lptUsd,
          ethPriceUsd: prices.ethUsd,
        },
      });
      count++;
    } catch (err: any) {
      console.warn(`[snapshot] failed for ${state.address}:`, err.message);
    }
  }

  console.log(`[snapshot] Upserted ${count} snapshots for round ${currentRound}`);
  return count;
}
