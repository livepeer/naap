/**
 * Orchestrator performance endpoint — monthly snapshot data and performance aggregation.
 * Dedicated Next.js route handler (replaces proxy to wallet backend on Vercel).
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { validateSession } from '@/lib/api/auth';
import { errors, getAuthToken } from '@/lib/api/response';

function isValidAddress(addr: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(addr);
}

export async function GET(request: NextRequest) {
  try {
    const token = getAuthToken(request);
    if (!token) return errors.unauthorized('No auth token provided');
    const user = await validateSession(token);
    if (!user) return errors.unauthorized('Invalid or expired session');

    const sp = request.nextUrl.searchParams;
    const mode = sp.get('mode') || 'all';
    const months = parseInt(sp.get('months') || '12', 10);
    const address = (sp.get('address') || '').toLowerCase();

    if (mode === 'staked' && !address) {
      return errors.badRequest('address required for staked mode');
    }
    if (address && !isValidAddress(address)) {
      return errors.badRequest('Invalid Ethereum address format');
    }

    let orchAddresses: string[] = [];

    if (mode === 'staked') {
      const stakingStates = await prisma.walletStakingState.findMany({
        where: { address },
        select: { delegatedTo: true },
      });
      orchAddresses = stakingStates
        .map((s) => s.delegatedTo?.toLowerCase())
        .filter(Boolean) as string[];

      if (!orchAddresses.length) {
        return NextResponse.json({
          orchestrators: [],
          synced: true,
          summary: { totalLptRewards: '0', totalEthFees: '0', totalStaked: '0', monthsTracked: 0 },
        });
      }
    }

    const orchWhere: Record<string, unknown> = mode === 'staked'
      ? { address: { in: orchAddresses } }
      : { isActive: true };

    const orchestrators = await prisma.walletOrchestrator.findMany({
      where: orchWhere,
      orderBy: { totalStake: 'desc' },
      take: mode === 'all' ? 50 : undefined,
      include: {
        capabilities: { select: { category: true } },
      },
    });

    if (mode === 'all' && orchestrators.length === 0) {
      return NextResponse.json({
        orchestrators: [],
        synced: false,
        summary: { totalLptRewards: '0', totalEthFees: '0', totalStaked: '0', monthsTracked: 0 },
      });
    }

    const cutoffMonth = new Date();
    cutoffMonth.setMonth(cutoffMonth.getMonth() - months);
    const cutoffStr = `${cutoffMonth.getFullYear()}-${String(cutoffMonth.getMonth() + 1).padStart(2, '0')}`;

    const snapshotWhere: Record<string, unknown> = { month: { gte: cutoffStr } };
    if (mode === 'staked') {
      snapshotWhere.walletAddress = address;
      snapshotWhere.orchestratorAddr = { in: orchAddresses };
    }

    const snapshots = await prisma.walletMonthlySnapshot.findMany({
      where: snapshotWhere,
      orderBy: { month: 'asc' },
    });

    const snapsByOrch = new Map<string, typeof snapshots>();
    for (const snap of snapshots) {
      const key = snap.orchestratorAddr;
      if (!snapsByOrch.has(key)) snapsByOrch.set(key, []);
      snapsByOrch.get(key)!.push(snap);
    }

    let totalLptRewards = 0n;
    let totalEthFees = 0n;
    let totalStaked = 0;

    const orchData = orchestrators.map((o) => {
      const monthlySnapshots = (snapsByOrch.get(o.address) || []).map((s) => ({
        month: s.month,
        bondedAmount: s.bondedAmount,
        lptRewardsAccrued: s.lptRewardsAccrued,
        ethFeesAccrued: s.ethFeesAccrued,
        lptPriceUsd: s.lptPriceUsd,
        ethPriceUsd: s.ethPriceUsd,
      }));

      const orchLptRewards = monthlySnapshots.reduce(
        (sum, s) => sum + BigInt(s.lptRewardsAccrued || '0'), 0n,
      );
      const orchEthFees = monthlySnapshots.reduce(
        (sum, s) => sum + BigInt(s.ethFeesAccrued || '0'), 0n,
      );

      totalLptRewards += orchLptRewards;
      totalEthFees += orchEthFees;
      totalStaked += parseFloat(o.totalStake || '0');

      return {
        address: o.address,
        name: o.name,
        rewardCut: o.rewardCut,
        feeShare: o.feeShare,
        totalStake: o.totalStake,
        rewardCallRatio: o.rewardCallRatio,
        totalVolumeETH: o.totalVolumeETH,
        categories: [...new Set(o.capabilities.map((c) => c.category))],
        monthlySnapshots,
        performance: {
          totalLptRewards: orchLptRewards.toString(),
          totalEthFees: orchEthFees.toString(),
          avgMonthlyRewardLpt: monthlySnapshots.length > 0
            ? (orchLptRewards / BigInt(monthlySnapshots.length)).toString()
            : '0',
          avgMonthlyFeeEth: monthlySnapshots.length > 0
            ? (orchEthFees / BigInt(monthlySnapshots.length)).toString()
            : '0',
        },
      };
    });

    const allMonths = new Set(snapshots.map((s) => s.month));

    return NextResponse.json({
      orchestrators: orchData,
      synced: true,
      summary: {
        totalLptRewards: totalLptRewards.toString(),
        totalEthFees: totalEthFees.toString(),
        totalStaked: totalStaked.toFixed(4),
        monthsTracked: allMonths.size,
      },
    });
  } catch (err) {
    console.error('[orchestratorPerformance] Error:', err);
    return errors.internal('Failed to fetch performance data');
  }
}
