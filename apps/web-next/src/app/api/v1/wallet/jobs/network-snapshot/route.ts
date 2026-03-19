/**
 * Vercel Cron trigger for network snapshot (S21)
 */

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { success, errors } from '@/lib/api/response';

export async function GET(request: NextRequest) {
  const secret = request.headers.get('authorization')?.replace('Bearer ', '');
  if (process.env.CRON_SECRET && secret !== process.env.CRON_SECRET) {
    return errors.unauthorized('Invalid cron secret');
  }

  try {
    const orchestrators = await prisma.walletOrchestrator.findMany({
      where: { isActive: true },
      select: { rewardCut: true, feeShare: true, totalStake: true },
    });

    const count = orchestrators.length;
    const avgRewardCut = count > 0
      ? orchestrators.reduce((sum: number, o) => sum + o.rewardCut, 0) / count
      : 0;
    const avgFeeShare = count > 0
      ? orchestrators.reduce((sum: number, o) => sum + o.feeShare, 0) / count
      : 0;

    let totalBonded = 0n;
    for (const o of orchestrators) {
      totalBonded += BigInt(o.totalStake || '0');
    }

    // Use round 0 as placeholder — will be updated when protocol params are available
    const round = Math.floor(Date.now() / 86400000); // Simple daily counter

    await prisma.walletNetworkSnapshot.upsert({
      where: { round },
      update: {
        totalBonded: totalBonded.toString(),
        activeOrchestrators: count,
        avgRewardCut: parseFloat(avgRewardCut.toFixed(2)),
        avgFeeShare: parseFloat(avgFeeShare.toFixed(2)),
      },
      create: {
        round,
        totalBonded: totalBonded.toString(),
        activeOrchestrators: count,
        avgRewardCut: parseFloat(avgRewardCut.toFixed(2)),
        avgFeeShare: parseFloat(avgFeeShare.toFixed(2)),
      },
    });

    return success({ recorded: true, round, activeOrchestrators: count });
  } catch (err) {
    console.error('Network snapshot error:', err);
    return errors.internal('Network snapshot failed');
  }
}
