/**
 * Risk score endpoint (S16)
 */

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { validateSession } from '@/lib/api/auth';
import { success, errors, getAuthToken } from '@/lib/api/response';

export async function GET(request: NextRequest) {
  try {
    const token = getAuthToken(request);
    if (!token) return errors.unauthorized('No auth token provided');
    const user = await validateSession(token);
    if (!user) return errors.unauthorized('Invalid or expired session');

    const address = request.nextUrl.searchParams.get('address');
    if (!address) return errors.badRequest('address is required');

    const orchestrator = await prisma.walletOrchestrator.findUnique({ where: { address } });
    if (!orchestrator) return errors.notFound('Orchestrator not found');

    // Get consistency data
    const history = await prisma.walletOrchestratorRoundHistory.findMany({
      where: { orchestratorAddr: address },
      orderBy: { round: 'desc' },
      take: 200,
    });

    const details: string[] = [];
    const totalRounds = history.length;
    const called = history.filter(h => h.calledReward).length;

    // Factor 1: Reward consistency (0-25)
    let rewardConsistency = totalRounds >= 10
      ? Math.min(25, Math.round((called / totalRounds) * 25))
      : 10;

    // Factor 2: Stake concentration (0-25)
    const totalStake = Number(BigInt(orchestrator.totalStake || '0')) / 1e18;
    let stakeConcentration = totalStake > 100000 ? 25 : totalStake > 50000 ? 20 : totalStake > 10000 ? 15 : totalStake > 1000 ? 10 : 5;

    // Factor 3: Tenure (0-25)
    const ageDays = (Date.now() - orchestrator.createdAt.getTime()) / 86400000;
    let tenure = ageDays > 365 ? 25 : ageDays > 180 ? 20 : ageDays > 90 ? 15 : ageDays > 30 ? 10 : 5;

    // Factor 4: Fee share stability (0-25)
    let feeShareStability = 25;
    if (history.length >= 5) {
      const changes = history.filter((h, i) => i > 0 && (h.feeShare !== history[i - 1].feeShare || h.rewardCut !== history[i - 1].rewardCut)).length;
      if (changes > 10) feeShareStability = 5;
      else if (changes > 5) feeShareStability = 15;
      else if (changes > 0) feeShareStability = 20;
    } else {
      feeShareStability = 15;
    }

    if (!orchestrator.isActive) details.push('Orchestrator is currently INACTIVE');

    const overallScore = rewardConsistency + stakeConcentration + tenure + feeShareStability;
    const grade = overallScore >= 85 ? 'A' : overallScore >= 70 ? 'B' : overallScore >= 55 ? 'C' : overallScore >= 40 ? 'D' : 'F';

    return success({
      orchestratorAddr: address,
      overallScore,
      factors: { rewardConsistency, stakeConcentration, tenure, feeShareStability },
      grade,
      details,
    });
  } catch (err) {
    console.error('Risk score error:', err);
    return errors.internal('Failed to calculate risk score');
  }
}
