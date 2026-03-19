/**
 * Network Benchmarks API
 * GET /api/v1/wallet/network/benchmarks
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

    const orchestrators = await prisma.walletOrchestrator.findMany({
      where: { isActive: true },
      select: { rewardCut: true, feeShare: true, totalStake: true },
    });

    const count = orchestrators.length;
    if (count === 0) {
      return success({
        avgRewardCut: 0, avgFeeShare: 0, medianRewardCut: 0,
        activeOrchestratorCount: 0, totalDelegatorStake: '0',
      });
    }

    const avgRewardCut = orchestrators.reduce((s, o) => s + o.rewardCut, 0) / count;
    const avgFeeShare = orchestrators.reduce((s, o) => s + o.feeShare, 0) / count;
    const sortedCuts = orchestrators.map(o => o.rewardCut).sort((a, b) => a - b);
    const mid = Math.floor(count / 2);
    const medianRewardCut = count % 2 === 0
      ? (sortedCuts[mid - 1] + sortedCuts[mid]) / 2
      : sortedCuts[mid];

    let totalStake = 0n;
    for (const o of orchestrators) totalStake += BigInt(o.totalStake || '0');

    return success({
      avgRewardCut: parseFloat(avgRewardCut.toFixed(2)),
      avgFeeShare: parseFloat(avgFeeShare.toFixed(2)),
      medianRewardCut: parseFloat(medianRewardCut.toFixed(2)),
      activeOrchestratorCount: count,
      totalDelegatorStake: totalStake.toString(),
    });
  } catch (err) {
    console.error('Error fetching benchmarks:', err);
    return errors.internal('Failed to fetch network benchmarks');
  }
}
