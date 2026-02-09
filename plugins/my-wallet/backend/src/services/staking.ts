/**
 * Staking Service - Chain data synchronization
 */

import { prisma } from '../db/client.js';

/**
 * Sync staking state from blockchain data
 * This would be called by a background job or triggered on-demand
 */
export async function syncStakingState(
  address: string,
  chainId: number,
  data: {
    stakedAmount: string;
    delegatedTo: string | null;
    pendingRewards: string;
    pendingFees: string;
    startRound?: string;
    lastClaimRound?: string;
  }
) {
  return prisma.walletStakingState.upsert({
    where: { address },
    update: {
      chainId,
      stakedAmount: data.stakedAmount,
      delegatedTo: data.delegatedTo,
      pendingRewards: data.pendingRewards,
      pendingFees: data.pendingFees,
      startRound: data.startRound,
      lastClaimRound: data.lastClaimRound,
      lastSynced: new Date(),
    },
    create: {
      address,
      chainId,
      stakedAmount: data.stakedAmount,
      delegatedTo: data.delegatedTo,
      pendingRewards: data.pendingRewards,
      pendingFees: data.pendingFees,
      startRound: data.startRound,
      lastClaimRound: data.lastClaimRound,
    },
  });
}

/**
 * Sync orchestrator data from chain
 */
export async function syncOrchestrator(
  data: {
    address: string;
    chainId: number;
    name?: string;
    serviceUri?: string;
    totalStake: string;
    rewardCut: number;
    feeShare: number;
    isActive: boolean;
  }
) {
  return prisma.walletOrchestrator.upsert({
    where: { address: data.address },
    update: {
      ...data,
      lastSynced: new Date(),
    },
    create: data,
  });
}

/**
 * Get top orchestrators by stake
 */
export async function getTopOrchestrators(chainId: number, limit = 50) {
  return prisma.walletOrchestrator.findMany({
    where: { 
      chainId, 
      isActive: true,
    },
    orderBy: { totalStake: 'desc' },
    take: limit,
  });
}

/**
 * Get staking state for multiple addresses
 */
export async function getStakingStates(addresses: string[]) {
  return prisma.walletStakingState.findMany({
    where: { address: { in: addresses } },
  });
}
