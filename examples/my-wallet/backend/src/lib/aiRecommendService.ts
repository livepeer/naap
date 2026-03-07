/**
 * AI recommendation service (V1: weighted scoring algorithm)
 * S19: Orchestrator recommendations based on user profile
 */

import { prisma } from '../db/client.js';
import { calculateRiskScore } from './riskScoreService.js';

export interface RecommendationProfile {
  riskTolerance: 'conservative' | 'moderate' | 'aggressive';
  targetYield: 'low' | 'medium' | 'high';
  diversify: boolean;
}

export interface OrchestratorRecommendation {
  address: string;
  name: string | null;
  score: number;          // 0-100 composite
  rewardCut: number;
  feeShare: number;
  totalStake: string;
  isActive: boolean;
  riskGrade: string;
  reasons: string[];
}

/**
 * Get top orchestrator recommendations
 */
export async function getRecommendations(
  userId: string,
  profile: RecommendationProfile,
  limit = 5,
): Promise<OrchestratorRecommendation[]> {
  // Get all active orchestrators
  const orchestrators = await prisma.walletOrchestrator.findMany({
    where: { isActive: true },
    orderBy: { totalStake: 'desc' },
    take: 50,
  });

  // Get user's current delegations to exclude
  const addresses = await prisma.walletAddress.findMany({
    where: { userId },
    include: { stakingStates: { select: { delegatedTo: true } } },
  });
  const currentOs = new Set(
    addresses.flatMap(a => a.stakingStates.map(s => s.delegatedTo).filter(Boolean))
  );

  // Score each orchestrator
  const scored: OrchestratorRecommendation[] = [];

  for (const o of orchestrators) {
    // Skip current delegations if diversifying
    if (profile.diversify && currentOs.has(o.address)) continue;

    let score = 50; // Baseline
    const reasons: string[] = [];
    let riskGrade = 'C';

    try {
      const risk = await calculateRiskScore(o.address);
      riskGrade = risk.grade;

      // Risk tolerance weighting
      if (profile.riskTolerance === 'conservative') {
        score += risk.overallScore >= 70 ? 20 : -10;
        if (risk.grade === 'A') reasons.push('Low risk profile');
      } else if (profile.riskTolerance === 'aggressive') {
        score += 10; // Less penalty for risk
        if (o.rewardCut < 10) reasons.push('Low reward cut — higher delegator yield');
      } else {
        score += risk.overallScore >= 50 ? 10 : -5;
      }

      // Yield preference
      const delegatorPct = (100 - o.rewardCut) / 100;
      if (profile.targetYield === 'high') {
        score += delegatorPct > 0.9 ? 20 : delegatorPct > 0.8 ? 10 : 0;
        if (delegatorPct > 0.9) reasons.push('High delegator reward share');
      } else if (profile.targetYield === 'low') {
        score += risk.overallScore >= 80 ? 15 : 0;
      } else {
        score += delegatorPct > 0.85 ? 10 : 0;
      }

      // Stake size bonus (bigger = more established)
      const stakeNum = Number(BigInt(o.totalStake || '0')) / 1e18;
      if (stakeNum > 50000) {
        score += 10;
        reasons.push('Large stake pool');
      }

      // Active penalty
      if (!o.isActive) {
        score -= 50;
        reasons.push('Currently inactive');
      }
    } catch {
      // Risk score calculation failed — use baseline
      riskGrade = '?';
    }

    scored.push({
      address: o.address,
      name: o.name,
      score: Math.max(0, Math.min(100, score)),
      rewardCut: o.rewardCut,
      feeShare: o.feeShare,
      totalStake: o.totalStake,
      isActive: o.isActive,
      riskGrade,
      reasons,
    });
  }

  // Sort by score descending and return top N
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}
