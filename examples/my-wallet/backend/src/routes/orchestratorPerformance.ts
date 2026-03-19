/**
 * Orchestrator performance routes — monthly snapshot data and performance aggregation.
 * Supports "all orchestrators" and "my staked orchestrators" modes.
 */

import { Router, Request, Response } from 'express';
import { prisma } from '../db/client.js';
import { monthlySnapshot } from '../jobs/monthlySnapshot.js';

const router = Router();

router.get('/api/v1/wallet/orchestrators/performance', async (req: Request, res: Response) => {
  try {
    const mode = (req.query.mode as string) || 'all';
    const months = parseInt((req.query.months as string) || '12');
    const address = (req.query.address as string || '').toLowerCase();

    if (mode === 'staked' && !address) {
      return res.status(400).json({ error: 'address required for staked mode' });
    }

    // Get orchestrators based on mode
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
        return res.json({ orchestrators: [], summary: { totalLptRewards: '0', totalEthFees: '0', totalStaked: '0', monthsTracked: 0 } });
      }
    }

    // Fetch orchestrator data
    const orchWhere: any = mode === 'staked'
      ? { address: { in: orchAddresses } }
      : { isActive: true };

    const orchestrators = await prisma.walletOrchestrator.findMany({
      where: orchWhere,
      orderBy: { totalStake: 'desc' },
      take: mode === 'all' ? 50 : undefined,
      include: {
        capabilities: {
          select: { category: true },
        },
      },
    });

    // Fetch monthly snapshots
    const cutoffMonth = new Date();
    cutoffMonth.setMonth(cutoffMonth.getMonth() - months);
    const cutoffStr = `${cutoffMonth.getFullYear()}-${String(cutoffMonth.getMonth() + 1).padStart(2, '0')}`;

    const snapshotWhere: any = { month: { gte: cutoffStr } };
    if (mode === 'staked') {
      snapshotWhere.walletAddress = address;
      snapshotWhere.orchestratorAddr = { in: orchAddresses };
    }

    const snapshots = await prisma.walletMonthlySnapshot.findMany({
      where: snapshotWhere,
      orderBy: { month: 'asc' },
    });

    // Group snapshots by orchestrator
    const snapsByOrch = new Map<string, typeof snapshots>();
    for (const snap of snapshots) {
      const key = snap.orchestratorAddr;
      if (!snapsByOrch.has(key)) snapsByOrch.set(key, []);
      snapsByOrch.get(key)!.push(snap);
    }

    let totalLptRewards = 0n;
    let totalEthFees = 0n;
    let totalStaked = 0n;

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
        (sum, s) => sum + BigInt(s.lptRewardsAccrued || '0'), 0n
      );
      const orchEthFees = monthlySnapshots.reduce(
        (sum, s) => sum + BigInt(s.ethFeesAccrued || '0'), 0n
      );

      totalLptRewards += orchLptRewards;
      totalEthFees += orchEthFees;
      totalStaked += BigInt(o.totalStake || '0');

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

    res.json({
      orchestrators: orchData,
      summary: {
        totalLptRewards: totalLptRewards.toString(),
        totalEthFees: totalEthFees.toString(),
        totalStaked: totalStaked.toString(),
        monthsTracked: allMonths.size,
      },
    });
  } catch (err: any) {
    console.error('[orchestratorPerformance] Error:', err.message);
    res.status(500).json({ error: 'Failed to fetch performance data' });
  }
});

// Manual trigger for monthly snapshot
router.post('/api/v1/wallet/snapshots/monthly', async (req: Request, res: Response) => {
  try {
    const count = await monthlySnapshot(true);
    res.json({ success: true, snapshotsCreated: count });
  } catch (err: any) {
    console.error('[orchestratorPerformance] manual snapshot error:', err.message);
    res.status(500).json({ error: 'Failed to create monthly snapshot' });
  }
});

export default router;
