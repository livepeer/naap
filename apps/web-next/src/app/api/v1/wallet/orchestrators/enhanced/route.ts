import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { validateSession } from '@/lib/api/auth';
import { errors, getAuthToken } from '@/lib/api/response';
import { getOrchestrators } from '@/lib/wallet/subgraph';

export async function GET(request: NextRequest) {
  try {
    const token = getAuthToken(request);
    if (!token) return errors.unauthorized('No auth token provided');
    const user = await validateSession(token);
    if (!user) return errors.unauthorized('Invalid or expired session');

    const { searchParams } = request.nextUrl;
    const from = searchParams.get('from');
    const to = searchParams.get('to');

    const [dbOrchestrators, liveOrchestrators] = await Promise.all([
      prisma.walletOrchestrator.findMany({
        where: { isActive: true },
        orderBy: { totalStake: 'desc' },
        take: 200,
        include: {
          capabilities: {
            select: { category: true, pipelineId: true, lastChecked: true },
          },
        },
      }),
      getOrchestrators().catch(() => [] as any[]),
    ]);

    const dbMap = new Map(
      dbOrchestrators.map((o) => [o.address.toLowerCase(), o]),
    );

    const synced = dbOrchestrators.length > 0;

    let data: any[];
    if (liveOrchestrators.length > 0) {
      data = liveOrchestrators.map((live: any) => {
        const db = dbMap.get(live.address.toLowerCase());
        return {
          address: live.address,
          name: db?.name || live.name || null,
          rewardCut: live.rewardCut,
          feeShare: live.feeShare,
          totalStake: live.totalStake || '0',
          isActive: true,
          lastRewardRound: live.lastRewardRound || 0,
          delegatorCount: live.delegatorCount || db?.delegatorCount || 0,
          totalVolumeETH: live.totalVolumeETH || '0',
          thirtyDayVolumeETH: live.thirtyDayVolumeETH || '0',
          ninetyDayVolumeETH: live.ninetyDayVolumeETH || '0',
          totalRewardTokens: live.totalRewardTokens || '0',
          rewardCallRatio: live.rewardCallRatio || db?.rewardCallRatio || 0,
          capabilities: db?.capabilities || [],
          categories: [...new Set((db?.capabilities || []).map((c: any) => c.category))],
          pipelines: (db?.capabilities || []).filter((c: any) => c.pipelineId).map((c: any) => c.pipelineId),
          rangePerformance: null as any,
        };
      });
    } else {
      data = dbOrchestrators.map((o) => ({
        address: o.address,
        name: o.name,
        rewardCut: o.rewardCut,
        feeShare: o.feeShare,
        totalStake: o.totalStake,
        isActive: o.isActive,
        lastRewardRound: o.lastRewardRound,
        delegatorCount: o.delegatorCount,
        totalVolumeETH: o.totalVolumeETH,
        thirtyDayVolumeETH: o.thirtyDayVolumeETH,
        ninetyDayVolumeETH: o.ninetyDayVolumeETH,
        totalRewardTokens: o.totalRewardTokens || '0',
        rewardCallRatio: o.rewardCallRatio,
        capabilities: o.capabilities,
        categories: [...new Set(o.capabilities.map((c) => c.category))],
        pipelines: o.capabilities.filter((c) => c.pipelineId).map((c) => c.pipelineId),
        rangePerformance: null as any,
      }));
    }

    if (from || to) {
      const historyWhere: any = {};
      if (from) historyWhere.createdAt = { ...historyWhere.createdAt, gte: new Date(parseInt(from)) };
      if (to) historyWhere.createdAt = { ...historyWhere.createdAt, lte: new Date(parseInt(to)) };

      const history = await prisma.walletOrchestratorRoundHistory.findMany({
        where: historyWhere,
        orderBy: { round: 'asc' },
      });

      const rangeStats: Record<string, { rounds: number; rewardCalls: number }> = {};
      for (const h of history) {
        if (!rangeStats[h.address]) rangeStats[h.address] = { rounds: 0, rewardCalls: 0 };
        rangeStats[h.address].rounds++;
        if (h.calledReward) rangeStats[h.address].rewardCalls++;
      }

      data = data.map((o) => ({
        ...o,
        rangePerformance: rangeStats[o.address] || null,
      }));
    }

    return NextResponse.json({ data, synced });
  } catch (err) {
    console.error('[orchestrators/enhanced] Error:', err);
    return errors.internal('Failed to fetch enhanced orchestrators');
  }
}
