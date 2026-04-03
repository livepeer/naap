/**
 * Rebalancing simulator service
 * S8: "What-if" scenario for moving stake between orchestrators
 * Uses live orchestrator data from RPC/subgraph instead of Prisma DB
 */

import { getOrchestrators, OrchestratorData } from './livepeer.js';

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
  const orchestrators = await getOrchestrators();

  const fromO = orchestrators.find(o => o.address.toLowerCase() === input.fromOrchestrator.toLowerCase());
  const toO = orchestrators.find(o => o.address.toLowerCase() === input.toOrchestrator.toLowerCase());

  if (!fromO) throw new Error(`Orchestrator ${input.fromOrchestrator} not found`);
  if (!toO) throw new Error(`Orchestrator ${input.toOrchestrator} not found`);

  const amountWei = BigInt(input.amountWei);
  const WEI = 10n ** 18n;
  const amountLpt = Number(amountWei / (WEI / 10000n)) / 10000;

  const fromDelegatorPct = (100 - fromO.rewardCut) / 100;
  const toDelegatorPct = (100 - toO.rewardCut) / 100;

  const baselineApr = 0.12;
  const fromYield = baselineApr * fromDelegatorPct * 100;
  const toYield = baselineApr * toDelegatorPct * 100;
  const yieldDelta = toYield - fromYield;

  const dailyReward = (amountLpt * baselineApr * toDelegatorPct) / 365;
  const opportunityCost = dailyReward * input.unbondingPeriodDays;

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
      name: null,
      currentRewardCut: fromO.rewardCut,
      currentFeeShare: fromO.feeShare,
    },
    toOrchestrator: {
      address: toO.address,
      name: null,
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
