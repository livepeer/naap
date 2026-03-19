/**
 * Rebalancing simulator endpoint (S8)
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
    const { fromOrchestrator, toOrchestrator, amountWei, unbondingPeriodDays = 7 } = body;

    if (!fromOrchestrator || !toOrchestrator || !amountWei) {
      return errors.badRequest('fromOrchestrator, toOrchestrator, and amountWei are required');
    }

    const [fromO, toO] = await Promise.all([
      prisma.walletOrchestrator.findUnique({ where: { address: fromOrchestrator } }),
      prisma.walletOrchestrator.findUnique({ where: { address: toOrchestrator } }),
    ]);

    if (!fromO) return errors.notFound('Source orchestrator not found');
    if (!toO) return errors.notFound('Target orchestrator not found');

    const amountLpt = Number(BigInt(amountWei)) / 1e18;
    const fromDelegatorPct = (100 - fromO.rewardCut) / 100;
    const toDelegatorPct = (100 - toO.rewardCut) / 100;
    const baselineApr = 0.12;
    const fromYield = baselineApr * fromDelegatorPct * 100;
    const toYield = baselineApr * toDelegatorPct * 100;
    const yieldDelta = toYield - fromYield;
    const dailyReward = (amountLpt * baselineApr * toDelegatorPct) / 365;
    const opportunityCost = dailyReward * unbondingPeriodDays;
    const annualGain = amountLpt * (yieldDelta / 100);
    const netBenefit = annualGain - opportunityCost;

    let recommendation: string;
    if (netBenefit > opportunityCost) recommendation = 'favorable';
    else if (netBenefit > 0) recommendation = 'neutral';
    else recommendation = 'unfavorable';

    return success({
      fromOrchestrator: { address: fromO.address, name: fromO.name, currentRewardCut: fromO.rewardCut, currentFeeShare: fromO.feeShare },
      toOrchestrator: { address: toO.address, name: toO.name, currentRewardCut: toO.rewardCut, currentFeeShare: toO.feeShare },
      amountLpt: parseFloat(amountLpt.toFixed(4)),
      projectedYieldDelta: parseFloat(yieldDelta.toFixed(4)),
      unbondingOpportunityCost: parseFloat(opportunityCost.toFixed(4)),
      rewardCutDiff: fromO.rewardCut - toO.rewardCut,
      feeShareDiff: fromO.feeShare - toO.feeShare,
      netBenefit: parseFloat(netBenefit.toFixed(4)),
      recommendation,
    });
  } catch (err) {
    console.error('Simulator error:', err);
    return errors.internal('Simulation failed');
  }
}
