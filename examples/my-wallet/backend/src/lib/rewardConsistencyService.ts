/**
 * Orchestrator reward-call consistency tracking
 * S9: % of rounds they called reward, miss streaks
 */

import { prisma } from '../db/client.js';

export interface RewardConsistency {
  orchestratorAddr: string;
  totalRounds: number;
  rewardsCalled: number;
  rewardsMissed: number;
  callRate: number;          // 0-100%
  currentMissStreak: number;
  longestMissStreak: number;
  recentHistory: { round: number; called: boolean }[];
}

/**
 * Get reward consistency data for an orchestrator
 */
export async function getRewardConsistency(
  orchestratorAddr: string,
  limit = 100,
): Promise<RewardConsistency> {
  const history = await prisma.walletOrchestratorRoundHistory.findMany({
    where: { orchestratorAddr },
    orderBy: { round: 'desc' },
    take: limit,
    select: { round: true, calledReward: true },
  });

  const totalRounds = history.length;
  const rewardsCalled = history.filter(h => h.calledReward).length;
  const rewardsMissed = totalRounds - rewardsCalled;
  const callRate = totalRounds > 0 ? parseFloat(((rewardsCalled / totalRounds) * 100).toFixed(2)) : 0;

  // Calculate miss streaks (history is sorted desc)
  let currentMissStreak = 0;
  let longestMissStreak = 0;
  let currentStreak = 0;

  for (const entry of history) {
    if (!entry.calledReward) {
      currentStreak++;
      if (currentStreak > longestMissStreak) longestMissStreak = currentStreak;
    } else {
      currentStreak = 0;
    }
  }

  // Current miss streak is from the most recent rounds
  for (const entry of history) {
    if (!entry.calledReward) {
      currentMissStreak++;
    } else {
      break;
    }
  }

  return {
    orchestratorAddr,
    totalRounds,
    rewardsCalled,
    rewardsMissed,
    callRate,
    currentMissStreak,
    longestMissStreak,
    recentHistory: history.slice(0, 20).map(h => ({
      round: h.round,
      called: h.calledReward,
    })),
  };
}

/**
 * Record reward call status for a round (used by cron job)
 */
export async function recordRoundHistory(
  orchestratorAddr: string,
  round: number,
  calledReward: boolean,
  rewardCut: number,
  feeShare: number,
  totalStake: string,
): Promise<void> {
  await prisma.walletOrchestratorRoundHistory.upsert({
    where: {
      orchestratorAddr_round: { orchestratorAddr, round },
    },
    update: { calledReward, rewardCut, feeShare, totalStake },
    create: { orchestratorAddr, round, calledReward, rewardCut, feeShare, totalStake },
  });
}
