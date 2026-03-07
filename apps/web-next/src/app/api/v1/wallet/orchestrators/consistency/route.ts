/**
 * Orchestrator reward consistency endpoint (S9)
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

    const limit = parseInt(request.nextUrl.searchParams.get('limit') || '100', 10);

    const history = await prisma.walletOrchestratorRoundHistory.findMany({
      where: { orchestratorAddr: address },
      orderBy: { round: 'desc' },
      take: limit,
      select: { round: true, calledReward: true },
    });

    const totalRounds = history.length;
    const rewardsCalled = history.filter(h => h.calledReward).length;

    let currentMissStreak = 0;
    let longestMissStreak = 0;
    let streak = 0;

    for (const entry of history) {
      if (!entry.calledReward) {
        streak++;
        if (streak > longestMissStreak) longestMissStreak = streak;
      } else {
        streak = 0;
      }
    }

    for (const entry of history) {
      if (!entry.calledReward) currentMissStreak++;
      else break;
    }

    return success({
      orchestratorAddr: address,
      totalRounds,
      rewardsCalled,
      rewardsMissed: totalRounds - rewardsCalled,
      callRate: totalRounds > 0 ? parseFloat(((rewardsCalled / totalRounds) * 100).toFixed(2)) : 0,
      currentMissStreak,
      longestMissStreak,
      recentHistory: history.slice(0, 20),
    });
  } catch (err) {
    console.error('Reward consistency error:', err);
    return errors.internal('Failed to fetch reward consistency');
  }
}
