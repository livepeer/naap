/**
 * AI orchestrator recommendations endpoint (S19)
 */

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { validateSession } from '@/lib/api/auth';
import { success, errors, getAuthToken } from '@/lib/api/response';

export async function POST(request: NextRequest) {
  try {
    const token = getAuthToken(request);
    if (!token) return errors.unauthorized('No auth token provided');
    const user = await validateSession(token);
    if (!user) return errors.unauthorized('Invalid or expired session');

    const body = await request.json();
    const { profile, limit = 5 } = body;

    const defaultProfile = { riskTolerance: 'moderate', targetYield: 'medium', diversify: true };
    const mergedProfile = { ...defaultProfile, ...profile };

    // Get active orchestrators
    const orchestrators = await prisma.walletOrchestrator.findMany({
      where: { isActive: true },
      orderBy: { totalStake: 'desc' },
      take: 50,
    });

    // Get user's current delegations
    const addresses = await prisma.walletAddress.findMany({
      where: { userId: user.id },
      include: { stakingStates: { select: { delegatedTo: true } } },
    });
    const currentOs = new Set(
      addresses.flatMap(a => a.stakingStates.map(s => s.delegatedTo).filter(Boolean))
    );

    const scored = orchestrators
      .filter(o => !mergedProfile.diversify || !currentOs.has(o.address))
      .map(o => {
        let score = 50;
        const reasons: string[] = [];
        const delegatorPct = (100 - o.rewardCut) / 100;

        // Risk tolerance
        const stakeNum = Number(BigInt(o.totalStake || '0')) / 1e18;
        if (mergedProfile.riskTolerance === 'conservative') {
          score += stakeNum > 50000 ? 20 : 0;
          if (stakeNum > 50000) reasons.push('Large established stake pool');
        } else if (mergedProfile.riskTolerance === 'aggressive') {
          score += delegatorPct > 0.95 ? 20 : 10;
        } else {
          score += stakeNum > 10000 ? 10 : 0;
        }

        // Yield preference
        if (mergedProfile.targetYield === 'high') {
          score += delegatorPct > 0.9 ? 20 : delegatorPct > 0.8 ? 10 : 0;
          if (delegatorPct > 0.9) reasons.push('High delegator reward share');
        } else if (mergedProfile.targetYield === 'low') {
          score += stakeNum > 100000 ? 15 : 0;
          if (stakeNum > 100000) reasons.push('Blue chip stability');
        } else {
          score += delegatorPct > 0.85 ? 10 : 0;
        }

        if (stakeNum > 50000) { score += 5; reasons.push('Large stake pool'); }

        return {
          address: o.address,
          name: o.name,
          score: Math.max(0, Math.min(100, score)),
          rewardCut: o.rewardCut,
          feeShare: o.feeShare,
          totalStake: o.totalStake,
          isActive: o.isActive,
          reasons,
        };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    return success(scored);
  } catch (err) {
    console.error('AI recommendation error:', err);
    return errors.internal('Failed to generate recommendations');
  }
}
