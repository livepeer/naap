/**
 * Orchestrator risk score service
 * S16: Composite risk based on consistency, concentration, tenure, stability
 */

import { prisma } from '../db/client.js';
import { getRewardConsistency } from './rewardConsistencyService.js';

export interface RiskScore {
  orchestratorAddr: string;
  overallScore: number;       // 0-100 (100 = lowest risk)
  factors: {
    rewardConsistency: number; // 0-25
    stakeConcentration: number; // 0-25
    tenure: number;            // 0-25
    feeShareStability: number; // 0-25
  };
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
  details: string[];
}

/**
 * Calculate composite risk score for an orchestrator
 */
export async function calculateRiskScore(orchestratorAddr: string): Promise<RiskScore> {
  const [orchestrator, consistency] = await Promise.all([
    prisma.walletOrchestrator.findUnique({ where: { address: orchestratorAddr } }),
    getRewardConsistency(orchestratorAddr, 200),
  ]);

  if (!orchestrator) throw new Error(`Orchestrator ${orchestratorAddr} not found`);

  const details: string[] = [];

  // Factor 1: Reward consistency (0-25)
  let rewardConsistency = 0;
  if (consistency.totalRounds >= 10) {
    rewardConsistency = Math.min(25, Math.round(consistency.callRate / 4));
    if (consistency.currentMissStreak > 5) {
      rewardConsistency = Math.max(0, rewardConsistency - 5);
      details.push(`Current miss streak: ${consistency.currentMissStreak} rounds`);
    }
  } else {
    rewardConsistency = 10; // Insufficient data = moderate risk
    details.push('Insufficient reward history data');
  }

  // Factor 2: Stake concentration (0-25) — higher total stake = lower concentration risk
  const totalStake = Number(BigInt(orchestrator.totalStake || '0')) / 1e18;
  let stakeConcentration = 0;
  if (totalStake > 100000) stakeConcentration = 25;
  else if (totalStake > 50000) stakeConcentration = 20;
  else if (totalStake > 10000) stakeConcentration = 15;
  else if (totalStake > 1000) stakeConcentration = 10;
  else {
    stakeConcentration = 5;
    details.push('Low total stake — higher concentration risk');
  }

  // Factor 3: Tenure (0-25) — how long the orchestrator has been active
  const ageMs = Date.now() - orchestrator.createdAt.getTime();
  const ageDays = ageMs / (24 * 60 * 60 * 1000);
  let tenure = 0;
  if (ageDays > 365) tenure = 25;
  else if (ageDays > 180) tenure = 20;
  else if (ageDays > 90) tenure = 15;
  else if (ageDays > 30) tenure = 10;
  else {
    tenure = 5;
    details.push('New orchestrator — limited track record');
  }

  // Factor 4: Fee share stability (0-25)
  // Check recent round history for fee share changes
  const recentHistory = await prisma.walletOrchestratorRoundHistory.findMany({
    where: { address: orchestratorAddr },
    orderBy: { round: 'desc' },
    take: 50,
    select: { feeShare: true, rewardCut: true },
  });

  let feeShareStability = 25;
  if (recentHistory.length >= 5) {
    const feeShares = recentHistory.map(h => h.feeShare);
    const rewardCuts = recentHistory.map(h => h.rewardCut);
    const feeShareChanges = feeShares.filter((v, i) => i > 0 && v !== feeShares[i - 1]).length;
    const rewardCutChanges = rewardCuts.filter((v, i) => i > 0 && v !== rewardCuts[i - 1]).length;

    const totalChanges = feeShareChanges + rewardCutChanges;
    if (totalChanges > 10) {
      feeShareStability = 5;
      details.push('Frequent fee/reward cut changes — unstable');
    } else if (totalChanges > 5) {
      feeShareStability = 15;
      details.push('Some fee/reward cut changes');
    } else if (totalChanges > 0) {
      feeShareStability = 20;
    }
  } else {
    feeShareStability = 15;
  }

  const overallScore = rewardConsistency + stakeConcentration + tenure + feeShareStability;

  let grade: 'A' | 'B' | 'C' | 'D' | 'F';
  if (overallScore >= 85) grade = 'A';
  else if (overallScore >= 70) grade = 'B';
  else if (overallScore >= 55) grade = 'C';
  else if (overallScore >= 40) grade = 'D';
  else grade = 'F';

  if (!orchestrator.isActive) {
    details.push('Orchestrator is currently INACTIVE');
  }

  return {
    orchestratorAddr,
    overallScore,
    factors: { rewardConsistency, stakeConcentration, tenure, feeShareStability },
    grade,
    details,
  };
}
