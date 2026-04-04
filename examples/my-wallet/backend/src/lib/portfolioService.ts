/**
 * Portfolio aggregation — queries staking state by address
 * Uses WalletStakingState directly (no WalletAddress dependency).
 * Falls back to live subgraph data when DB has no staking state.
 */

import { prisma } from '../db/client.js';
import { getDelegator, toWei } from './livepeer.js';

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
  const addr = userId.toLowerCase();

  // Try DB-backed staking state first
  let state: any = null;
  try {
    state = await prisma.walletStakingState.findUnique({ where: { address: addr } });
  } catch { /* DB unavailable */ }

  let totalStaked = 0n;
  let totalPendingRewards = 0n;
  let totalPendingFees = 0n;
  const positions: PositionDetail[] = [];

  if (state && state.stakedAmount !== '0') {
    const staked = BigInt(state.stakedAmount || '0');
    const rewards = BigInt(state.pendingRewards || '0');
    const fees = BigInt(state.pendingFees || '0');

    totalStaked += staked;
    totalPendingRewards += rewards;
    totalPendingFees += fees;

    positions.push({
      walletAddressId: state.id || addr,
      address: addr,
      label: null,
      chainId: state.chainId || 42161,
      orchestrator: state.delegatedTo,
      stakedAmount: state.stakedAmount,
      pendingRewards: state.pendingRewards,
      pendingFees: state.pendingFees,
      startRound: state.startRound,
      lastClaimRound: state.lastClaimRound,
    });
  } else {
    // Fallback: query live subgraph
    try {
      const delegator = await getDelegator(addr);
      if (delegator && delegator.bondedAmount !== '0') {
        const principal = BigInt(toWei(delegator.principal));
        const bonded = BigInt(toWei(delegator.bondedAmount));
        const fees = BigInt(toWei(delegator.fees));
        const rewards = bonded > principal ? bonded - principal : 0n;

        totalStaked = bonded;
        totalPendingRewards = rewards;
        totalPendingFees = fees;

        positions.push({
          walletAddressId: addr,
          address: addr,
          label: null,
          chainId: 42161,
          orchestrator: delegator.delegateAddress,
          stakedAmount: bonded.toString(),
          pendingRewards: rewards.toString(),
          pendingFees: fees.toString(),
          startRound: delegator.startRound,
          lastClaimRound: delegator.lastClaimRound,
        });
      }
    } catch (err: any) {
      console.warn('[portfolioService] Live fallback failed:', err.message);
    }
  }

  // Enrich with orchestrator info from DB
  const orchestratorAddrs = positions
    .map(p => p.orchestrator)
    .filter((a): a is string => a !== null);

  if (orchestratorAddrs.length > 0) {
    try {
      const orchestrators = await prisma.walletOrchestrator.findMany({
        where: { address: { in: orchestratorAddrs } },
      });
      const oMap = new Map(orchestrators.map(o => [o.address, o]));

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
    } catch { /* DB unavailable — skip enrichment */ }
  }

  return {
    totalStaked: totalStaked.toString(),
    totalPendingRewards: totalPendingRewards.toString(),
    totalPendingFees: totalPendingFees.toString(),
    addressCount: positions.length,
    positions,
  };
}

export async function getPositions(userId: string): Promise<PositionDetail[]> {
  const portfolio = await getPortfolio(userId);
  return portfolio.positions;
}
