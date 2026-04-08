/**
 * Yield API Route
 * GET /api/v1/wallet/yield - Compute annualized yield from snapshots
 */

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { validateSession } from '@/lib/api/auth';
import { success, errors, getAuthToken } from '@/lib/api/response';

function parsePeriod(period: string): number {
  switch (period) {
    case '7d': return 7;
    case '30d': return 30;
    case '90d': return 90;
    case 'ytd': {
      const now = new Date();
      const jan1 = new Date(now.getFullYear(), 0, 1);
      return Math.max(1, Math.floor((now.getTime() - jan1.getTime()) / (24 * 60 * 60 * 1000)));
    }
    default: return 30;
  }
}

export async function GET(request: NextRequest) {
  try {
    const token = getAuthToken(request);
    if (!token) return errors.unauthorized('No auth token provided');

    const user = await validateSession(token);
    if (!user) return errors.unauthorized('Invalid or expired session');

    const period = request.nextUrl.searchParams.get('period') || '30d';
    const periodDays = parsePeriod(period);
    const since = new Date(Date.now() - periodDays * 24 * 60 * 60 * 1000);

    const userWallets = await prisma.walletAddress.findMany({
      where: { userId: user.id },
      select: { address: true },
    });
    const addresses = userWallets.map((w) => w.address.toLowerCase());

    if (addresses.length === 0) {
      return success({
        rewardYield: 0,
        feeYield: 0,
        combinedApy: 0,
        periodDays,
        dataPoints: 0,
        chart: [],
      });
    }

    const snapshots = await prisma.walletStakingSnapshot.findMany({
      where: {
        address: { in: addresses },
        createdAt: { gte: since },
      },
      orderBy: { createdAt: 'asc' },
    });

    if (snapshots.length < 2) {
      return success({
        rewardYield: 0, feeYield: 0, combinedApy: 0,
        periodDays, dataPoints: snapshots.length, chart: [],
      });
    }

    const first = snapshots[0];
    const last = snapshots[snapshots.length - 1];
    const startBonded = first.bondedAmount;

    if (BigInt(startBonded) === 0n) {
      return success({
        rewardYield: 0, feeYield: 0, combinedApy: 0,
        periodDays, dataPoints: snapshots.length, chart: [],
      });
    }

    const startBondedBig = BigInt(startBonded.toString());
    const stakeGain = BigInt(last.pendingStake.toString()) - BigInt(first.pendingStake.toString());
    const feeGain = BigInt(last.pendingFees.toString()) - BigInt(first.pendingFees.toString());

    const PRECISION = 100_000_000n;
    const rewardPeriod = Number((stakeGain * PRECISION) / startBondedBig) / Number(PRECISION);
    const feePeriod = Number((feeGain * PRECISION) / startBondedBig) / Number(PRECISION);

    const annualize = 365 / Math.max(1, periodDays);
    const rewardYield = parseFloat((rewardPeriod * annualize * 100).toFixed(4));
    const feeYield = parseFloat((feePeriod * annualize * 100).toFixed(4));
    const combinedApy = parseFloat(((rewardPeriod + feePeriod) * annualize * 100).toFixed(4));

    const chart = snapshots.map(s => {
      const sg = BigInt(s.pendingStake.toString()) - BigInt(first.pendingStake.toString());
      const fg = BigInt(s.pendingFees.toString()) - BigInt(first.pendingFees.toString());
      const r = Number((sg * PRECISION) / startBondedBig) / Number(PRECISION) * 100;
      const f = Number((fg * PRECISION) / startBondedBig) / Number(PRECISION) * 100;
      return {
        date: s.createdAt.toISOString(),
        round: s.round,
        cumulativeRewardYield: parseFloat(r.toFixed(4)),
        cumulativeFeeYield: parseFloat(f.toFixed(4)),
        cumulativeCombined: parseFloat((r + f).toFixed(4)),
      };
    });

    return success({ rewardYield, feeYield, combinedApy, periodDays, dataPoints: snapshots.length, chart });
  } catch (err) {
    console.error('Error calculating yield:', err);
    return errors.internal('Failed to calculate yield');
  }
}
