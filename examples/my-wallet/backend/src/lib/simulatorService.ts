/**
 * Rebalancing simulator service
 * S8: "What-if" scenario for moving stake between orchestrators
 */

import { prisma } from '../db/client.js';

export interface SimulationInput {
  fromOrchestrator: string;
  toOrchestrator: string;
  amountWei: string;
  unbondingPeriodDays: number;
}

export interface SimulationResult {
  fromOrchestrator: {
    address: string;
    name: string | null;
    currentRewardCut: number;
    currentFeeShare: number;
  };
  toOrchestrator: {
    address: string;
    name: string | null;
    currentRewardCut: number;
    currentFeeShare: number;
  };
  amountLpt: number;
  projectedYieldDelta: number;       // annual % change
  unbondingOpportunityCost: number;  // LPT lost during unbonding
  rewardCutDiff: number;             // from - to
  feeShareDiff: number;
  netBenefit: number;                // projected annual LPT gain/loss
  recommendation: 'favorable' | 'neutral' | 'unfavorable';
}

/**
 * Simulate rebalancing from one O to another
 */
export async function simulateRebalance(input: SimulationInput): Promise<SimulationResult> {
  const [fromO, toO] = await Promise.all([
    prisma.walletOrchestrator.findUnique({ where: { address: input.fromOrchestrator } }),
    prisma.walletOrchestrator.findUnique({ where: { address: input.toOrchestrator } }),
  ]);

  if (!fromO) throw new Error(`Orchestrator ${input.fromOrchestrator} not found`);
  if (!toO) throw new Error(`Orchestrator ${input.toOrchestrator} not found`);

  const amountWei = BigInt(input.amountWei);
  const amountLpt = Number(amountWei) / 1e18;

  // Reward cut is a percentage of rewards kept by O (higher = less for delegator)
  // Delegator gets (100 - rewardCut)% of rewards
  const fromDelegatorPct = (100 - fromO.rewardCut) / 100;
  const toDelegatorPct = (100 - toO.rewardCut) / 100;

  // Approximate annual reward rate: ~10-15% APR for typical LPT staking
  // Use a baseline of 12% and adjust by delegator percentage
  const baselineApr = 0.12;
  const fromYield = baselineApr * fromDelegatorPct * 100;
  const toYield = baselineApr * toDelegatorPct * 100;
  const yieldDelta = toYield - fromYield;

  // Unbonding opportunity cost: rewards missed during unbonding period
  const dailyReward = (amountLpt * baselineApr * toDelegatorPct) / 365;
  const opportunityCost = dailyReward * input.unbondingPeriodDays;

  // First-year net benefit
  const annualGain = amountLpt * (yieldDelta / 100);
  const netBenefit = annualGain - opportunityCost;

  let recommendation: 'favorable' | 'neutral' | 'unfavorable';
  if (netBenefit > opportunityCost) {
    recommendation = 'favorable';
  } else if (netBenefit > 0) {
    recommendation = 'neutral';
  } else {
    recommendation = 'unfavorable';
  }

  return {
    fromOrchestrator: {
      address: fromO.address,
      name: fromO.name,
      currentRewardCut: fromO.rewardCut,
      currentFeeShare: fromO.feeShare,
    },
    toOrchestrator: {
      address: toO.address,
      name: toO.name,
      currentRewardCut: toO.rewardCut,
      currentFeeShare: toO.feeShare,
    },
    amountLpt: parseFloat(amountLpt.toFixed(4)),
    projectedYieldDelta: parseFloat(yieldDelta.toFixed(4)),
    unbondingOpportunityCost: parseFloat(opportunityCost.toFixed(4)),
    rewardCutDiff: fromO.rewardCut - toO.rewardCut,
    feeShareDiff: fromO.feeShare - toO.feeShare,
    netBenefit: parseFloat(netBenefit.toFixed(4)),
    recommendation,
  };
}
