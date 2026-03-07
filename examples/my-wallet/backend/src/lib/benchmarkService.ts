/**
 * Network benchmark aggregation
 */

import { prisma } from '../db/client.js';
import { getProtocolParams } from './protocolService.js';

export interface NetworkBenchmarks {
  totalBonded: string;
  participationRate: number;
  inflation: string;
  avgRewardCut: number;
  avgFeeShare: number;
  medianRewardCut: number;
  activeOrchestratorCount: number;
  totalDelegatorStake: string;
}

export async function getNetworkBenchmarks(): Promise<NetworkBenchmarks> {
  const [protocolParams, orchestrators] = await Promise.all([
    getProtocolParams(),
    prisma.walletOrchestrator.findMany({
      where: { isActive: true },
      select: { rewardCut: true, feeShare: true, totalStake: true },
    }),
  ]);

  const count = orchestrators.length;
  if (count === 0) {
    return {
      totalBonded: protocolParams.totalBonded,
      participationRate: protocolParams.participationRate,
      inflation: protocolParams.inflation,
      avgRewardCut: 0,
      avgFeeShare: 0,
      medianRewardCut: 0,
      activeOrchestratorCount: 0,
      totalDelegatorStake: '0',
    };
  }

  const avgRewardCut = orchestrators.reduce((sum: number, o) => sum + o.rewardCut, 0) / count;
  const avgFeeShare = orchestrators.reduce((sum: number, o) => sum + o.feeShare, 0) / count;

  const sortedCuts = orchestrators.map((o) => o.rewardCut).sort((a: number, b: number) => a - b);
  const mid = Math.floor(count / 2);
  const medianRewardCut = count % 2 === 0
    ? (sortedCuts[mid - 1] + sortedCuts[mid]) / 2
    : sortedCuts[mid];

  let totalDelegatorStake = 0n;
  for (const o of orchestrators) {
    totalDelegatorStake += BigInt(o.totalStake || '0');
  }

  return {
    totalBonded: protocolParams.totalBonded,
    participationRate: protocolParams.participationRate,
    inflation: protocolParams.inflation,
    avgRewardCut: parseFloat(avgRewardCut.toFixed(2)),
    avgFeeShare: parseFloat(avgFeeShare.toFixed(2)),
    medianRewardCut: parseFloat(medianRewardCut.toFixed(2)),
    activeOrchestratorCount: count,
    totalDelegatorStake: totalDelegatorStake.toString(),
  };
}
