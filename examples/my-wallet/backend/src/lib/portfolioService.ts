/**
 * Portfolio aggregation — queries staking state across all user addresses
 */

import { prisma } from '../db/client.js';

export interface PortfolioSummary {
  totalStaked: string;
  totalPendingRewards: string;
  totalPendingFees: string;
  addressCount: number;
  positions: PositionDetail[];
}

export interface PositionDetail {
  walletAddressId: string;
  address: string;
  label: string | null;
  chainId: number;
  orchestrator: string | null;
  stakedAmount: string;
  pendingRewards: string;
  pendingFees: string;
  startRound: string | null;
  lastClaimRound: string | null;
  orchestratorInfo?: {
    name: string | null;
    rewardCut: number;
    feeShare: number;
    totalStake: string;
    isActive: boolean;
  };
}

export async function getPortfolio(userId: string): Promise<PortfolioSummary> {
  const addresses = await prisma.walletAddress.findMany({
    where: { userId },
    include: {
      stakingStates: true,
    },
    orderBy: [{ isPrimary: 'desc' }, { connectedAt: 'asc' }],
  });

  let totalStaked = 0n;
  let totalPendingRewards = 0n;
  let totalPendingFees = 0n;
  const positions: PositionDetail[] = [];

  for (const addr of addresses) {
    const state = addr.stakingStates[0];
    if (state) {
      const staked = BigInt(state.stakedAmount || '0');
      const rewards = BigInt(state.pendingRewards || '0');
      const fees = BigInt(state.pendingFees || '0');

      totalStaked += staked;
      totalPendingRewards += rewards;
      totalPendingFees += fees;

      positions.push({
        walletAddressId: addr.id,
        address: addr.address,
        label: addr.label,
        chainId: addr.chainId,
        orchestrator: state.delegatedTo,
        stakedAmount: state.stakedAmount,
        pendingRewards: state.pendingRewards,
        pendingFees: state.pendingFees,
        startRound: state.startRound,
        lastClaimRound: state.lastClaimRound,
      });
    } else {
      positions.push({
        walletAddressId: addr.id,
        address: addr.address,
        label: addr.label,
        chainId: addr.chainId,
        orchestrator: null,
        stakedAmount: '0',
        pendingRewards: '0',
        pendingFees: '0',
        startRound: null,
        lastClaimRound: null,
      });
    }
  }

  // Enrich with orchestrator info
  const orchestratorAddrs = positions
    .map(p => p.orchestrator)
    .filter((a): a is string => a !== null);

  if (orchestratorAddrs.length > 0) {
    const orchestrators = await prisma.walletOrchestrator.findMany({
      where: { address: { in: orchestratorAddrs } },
    });
    const oMap = new Map(orchestrators.map((o: { address: string; name: string | null; rewardCut: number; feeShare: number; totalStake: string; isActive: boolean }) => [o.address, o] as const));

    for (const pos of positions) {
      if (pos.orchestrator) {
        const o = oMap.get(pos.orchestrator);
        if (o) {
          pos.orchestratorInfo = {
            name: o.name,
            rewardCut: o.rewardCut,
            feeShare: o.feeShare,
            totalStake: o.totalStake,
            isActive: o.isActive,
          };
        }
      }
    }
  }

  return {
    totalStaked: totalStaked.toString(),
    totalPendingRewards: totalPendingRewards.toString(),
    totalPendingFees: totalPendingFees.toString(),
    addressCount: addresses.length,
    positions,
  };
}

export async function getPositions(userId: string): Promise<PositionDetail[]> {
  const portfolio = await getPortfolio(userId);
  return portfolio.positions;
}
