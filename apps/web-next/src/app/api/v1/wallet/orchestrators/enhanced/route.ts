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

    const dbOrchestrators = await prisma.walletOrchestrator.findMany({
      where: { isActive: true },
      orderBy: { totalStake: 'desc' },
      include: {
        capabilities: {
          select: { category: true, pipelineId: true, lastChecked: true },
        },
      },
    });

    if (dbOrchestrators.length > 0) {
      const data = dbOrchestrators.map((o) => ({
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
        rewardCallRatio: o.rewardCallRatio,
        capabilities: o.capabilities,
      }));
      return NextResponse.json({ data, synced: true });
    }

    let subgraphData: any[] = [];
    try {
      subgraphData = await getOrchestrators();
    } catch {
      // fallback to empty
    }

    return NextResponse.json({ data: subgraphData, synced: false });
  } catch (err) {
    console.error('[orchestrators/enhanced] Error:', err);
    return errors.internal('Failed to fetch enhanced orchestrators');
  }
}
