/**
 * Multi-Orchestrator Distribution Simulator Service
 *
 * Generates 3 risk-level strategies for distributing LPT across orchestrators.
 */

import { getOrchestrators, getPrices, getProtocol } from './livepeer.js';

export interface MultiOInput {
  amountLpt: number;
  durationMonths: number;
  expectedReturnMin: number;
  expectedReturnMax: number;
}

export interface OrchestratorAllocation {
  address: string;
  name: string | null;
  rewardCut: number;
  totalStake: string;
  healthScore: number;
  allocationPct: number;
  allocationLpt: number;
  projectedApr: number;
  rationale: string;
}

export interface Strategy {
  riskLevel: 'high' | 'medium' | 'low';
  label: string;
  projectedApr: number;
  projectedReturn: number;
  allocations: OrchestratorAllocation[];
  riskFactors: string[];
}

export interface MultiOResult {
  input: MultiOInput;
  strategies: [Strategy, Strategy, Strategy];
  networkAvgApr: number;
  priceAtSimulation: { lptUsd: number };
}

interface ScoredOrchestrator {
  address: string;
  name: string | null;
  rewardCut: number;
  totalStake: string;
  totalStakeNum: number;
  rewardCallRatio: number;
  delegatorCount: number;
  healthScore: number;
  estimatedApr: number;
}

function computeHealthScore(o: { rewardCallRatio: number; delegatorCount: number; totalStakeNum: number }): number {
  const callScore = Math.min(o.rewardCallRatio * 100, 100);
  const stakeScore = Math.min(o.totalStakeNum / 100000, 30);
  const delegatorScore = Math.min(o.delegatorCount / 5, 20);
  return Math.round(callScore * 0.5 + stakeScore + delegatorScore);
}

function estimateApr(rewardCut: number, baseApr: number): number {
  return baseApr * (100 - rewardCut) / 100;
}

function buildAllocations(
  orchestrators: ScoredOrchestrator[],
  percentages: number[],
  amountLpt: number,
): OrchestratorAllocation[] {
  return orchestrators.map((o, i) => ({
    address: o.address,
    name: o.name,
    rewardCut: o.rewardCut,
    totalStake: o.totalStake,
    healthScore: o.healthScore,
    allocationPct: percentages[i],
    allocationLpt: parseFloat((amountLpt * percentages[i] / 100).toFixed(4)),
    projectedApr: o.estimatedApr,
    rationale: generateRationale(o),
  }));
}

function generateRationale(o: ScoredOrchestrator): string {
  const parts: string[] = [];
  if (o.totalStakeNum > 100000) parts.push(`Top-tier stake (${(o.totalStakeNum / 1000).toFixed(0)}K LPT)`);
  else if (o.totalStakeNum > 10000) parts.push(`Mid-tier stake (${(o.totalStakeNum / 1000).toFixed(0)}K LPT)`);
  else parts.push('Smaller stake, higher growth potential');

  if (o.rewardCallRatio >= 0.99) parts.push(`${(o.rewardCallRatio * 100).toFixed(1)}% uptime`);
  else if (o.rewardCallRatio >= 0.9) parts.push('Good uptime');

  if (o.rewardCut < 5) parts.push('Very low reward cut');
  else if (o.rewardCut < 15) parts.push('Competitive reward cut');

  return parts.join(', ');
}

export async function simulateMultiOrchestrator(input: MultiOInput): Promise<MultiOResult> {
  if (input.amountLpt <= 0) throw new Error('Amount must be positive');
  if (input.durationMonths <= 0) throw new Error('Duration must be positive');

  const [rawOrchestrators, prices, protocol] = await Promise.all([
    getOrchestrators(),
    getPrices(),
    getProtocol(),
  ]);

  const totalSupplyLpt = parseFloat(protocol.totalSupply || '0');
  const totalBondedLpt = parseFloat(protocol.totalActiveStake || '0');
  const inflationRaw = parseFloat(protocol.inflation || '0');
  const newTokensPerRound = totalSupplyLpt * inflationRaw / 1e9;
  const baseApr = totalBondedLpt > 0
    ? (newTokensPerRound / totalBondedLpt) * 365 * 100
    : 15;

  const scored: ScoredOrchestrator[] = rawOrchestrators
    .filter((o: any) => {
      const stake = parseFloat(o.totalStake || '0');
      return o.active && stake > 0;
    })
    .map((o: any) => {
      const totalStakeNum = parseFloat(o.totalStake || '0');
      return {
        address: o.address,
        name: o.name || null,
        rewardCut: o.rewardCut ?? 0,
        totalStake: o.totalStake || '0',
        totalStakeNum,
        rewardCallRatio: o.rewardCallRatio ?? 0,
        delegatorCount: o.delegatorCount ?? 0,
        healthScore: computeHealthScore({
          rewardCallRatio: o.rewardCallRatio ?? 0,
          delegatorCount: o.delegatorCount ?? 0,
          totalStakeNum,
        }),
        estimatedApr: estimateApr(o.rewardCut ?? 0, baseApr),
      };
    })
    .sort((a: ScoredOrchestrator, b: ScoredOrchestrator) => b.healthScore - a.healthScore);

  const networkAvgApr = scored.length > 0
    ? scored.reduce((sum: number, o: ScoredOrchestrator) => sum + o.estimatedApr, 0) / scored.length
    : baseApr;

  // High risk: lowest reward cuts (highest delegator returns), smaller/newer orchestrators
  const highRiskPool = [...scored]
    .sort((a, b) => a.rewardCut - b.rewardCut)
    .filter(o => o.totalStakeNum < 100000)
    .slice(0, 10);
  const highRiskPicks = highRiskPool.slice(0, Math.min(4, highRiskPool.length));
  if (highRiskPicks.length === 0 && scored.length > 0) {
    highRiskPicks.push(...scored.slice(0, Math.min(3, scored.length)));
  }

  // Low risk: top by total stake, highest health scores
  const lowRiskPool = [...scored]
    .sort((a, b) => b.totalStakeNum - a.totalStakeNum)
    .slice(0, 10);
  const lowRiskPicks = lowRiskPool.slice(0, Math.min(3, lowRiskPool.length));

  // Medium risk: mid-tier — decent stake, reasonable cuts
  const usedAddresses = new Set([
    ...highRiskPicks.map(o => o.address),
    ...lowRiskPicks.map(o => o.address),
  ]);
  const mediumPool = scored
    .filter(o => !usedAddresses.has(o.address))
    .slice(0, 10);
  let mediumPicks = mediumPool.slice(0, Math.min(4, mediumPool.length));
  if (mediumPicks.length < 3 && scored.length >= 3) {
    mediumPicks = scored.slice(
      Math.floor(scored.length * 0.25),
      Math.floor(scored.length * 0.25) + 4,
    );
  }

  function distributePercentages(count: number): number[] {
    if (count === 0) return [];
    if (count === 1) return [100];
    if (count === 2) return [60, 40];
    if (count === 3) return [45, 35, 20];
    return [35, 30, 20, 15].slice(0, count);
  }

  function buildStrategy(
    picks: ScoredOrchestrator[],
    riskLevel: 'high' | 'medium' | 'low',
    label: string,
    riskFactors: string[],
  ): Strategy {
    if (picks.length === 0) {
      return {
        riskLevel,
        label,
        projectedApr: 0,
        projectedReturn: 0,
        allocations: [],
        riskFactors: ['No eligible orchestrators found'],
      };
    }
    const pcts = distributePercentages(picks.length);
    const allocations = buildAllocations(picks, pcts, input.amountLpt);
    const weightedApr = allocations.reduce(
      (sum, a) => sum + (a.allocationPct / 100) * a.projectedApr, 0,
    );
    const projectedReturn = input.amountLpt * (weightedApr / 100) * (input.durationMonths / 12);

    return {
      riskLevel,
      label,
      projectedApr: parseFloat(weightedApr.toFixed(2)),
      projectedReturn: parseFloat(projectedReturn.toFixed(4)),
      allocations,
      riskFactors,
    };
  }

  const strategies: [Strategy, Strategy, Strategy] = [
    buildStrategy(highRiskPicks, 'high', 'Aggressive', [
      'Newer orchestrators with less proven track record',
      'Higher variance in returns',
      'Lower total stake means less proven reliability',
    ]),
    buildStrategy(mediumPicks, 'medium', 'Balanced', [
      'Mix of established and growing orchestrators',
      'Moderate variance in returns',
      'Balanced between yield and reliability',
    ]),
    buildStrategy(lowRiskPicks, 'low', 'Conservative', [
      'Top orchestrators by total stake',
      'Highest reliability and uptime',
      'Lower returns due to higher reward cuts',
    ]),
  ];

  return {
    input,
    strategies,
    networkAvgApr: parseFloat(networkAvgApr.toFixed(2)),
    priceAtSimulation: { lptUsd: prices.lptUsd },
  };
}
