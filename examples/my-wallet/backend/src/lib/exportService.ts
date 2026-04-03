/**
 * Export formatting (CSV/JSON) for leaderboard and positions
 */

import { prisma } from '../db/client.js';
import { buildCsv, CsvColumn } from './csvBuilder.js';
import { getPositions } from './portfolioService.js';
import { getOrchestrators } from './livepeer.js';

export type ExportFormat = 'csv' | 'json';

/**
 * Export orchestrator leaderboard — reads from DB, falls back to live subgraph
 */
export async function exportLeaderboard(format: ExportFormat): Promise<{ data: string; contentType: string; filename: string }> {
  let orchestrators = await prisma.walletOrchestrator.findMany({
    where: { isActive: true },
    orderBy: { totalStake: 'desc' },
  });

  // If DB is empty, fall back to live subgraph data
  if (orchestrators.length === 0) {
    try {
      const live = await getOrchestrators();
      orchestrators = live.map((o: any) => ({
        id: o.address,
        address: o.address,
        chainId: 42161,
        name: null,
        serviceUri: o.serviceURI,
        totalStake: o.totalStake,
        rewardCut: Math.round(o.rewardCut * 100),
        feeShare: Math.round(o.feeShare * 100),
        isActive: o.active,
        lastSynced: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
        activationRound: o.activationRound || null,
        deactivationRound: o.deactivationRound || null,
        totalVolumeETH: o.totalVolumeETH || '0',
        thirtyDayVolumeETH: o.thirtyDayVolumeETH || '0',
        ninetyDayVolumeETH: o.ninetyDayVolumeETH || '0',
        totalRewardTokens: o.totalRewardTokens || '0',
        lastRewardRound: parseInt(o.lastRewardRound) || 0,
        delegatorCount: o.delegatorCount || 0,
        rewardCallRatio: o.rewardCallRatio || 0,
        syncedAtRound: 0,
      }));
    } catch (err: any) {
      console.warn('[exportService] Live fallback failed:', err.message);
    }
  }

  if (format === 'json') {
    return {
      data: JSON.stringify(orchestrators, null, 2),
      contentType: 'application/json',
      filename: `leaderboard-${dateStamp()}.json`,
    };
  }

  const columns: CsvColumn<typeof orchestrators[0]>[] = [
    { header: 'Address', accessor: r => r.address },
    { header: 'Name', accessor: r => r.name },
    { header: 'Reward Cut (%)', accessor: r => (r.rewardCut / 10000).toFixed(2) },
    { header: 'Fee Share (%)', accessor: r => (r.feeShare / 10000).toFixed(2) },
    { header: 'Total Stake', accessor: r => r.totalStake },
    { header: 'Active', accessor: r => r.isActive },
    { header: 'Service URI', accessor: r => r.serviceUri },
    { header: 'Last Synced', accessor: r => r.lastSynced.toISOString() },
  ];

  return {
    data: buildCsv(orchestrators, columns),
    contentType: 'text/csv',
    filename: `leaderboard-${dateStamp()}.csv`,
  };
}

/**
 * Export user positions
 */
export async function exportPositions(userId: string, format: ExportFormat): Promise<{ data: string; contentType: string; filename: string }> {
  const positions = await getPositions(userId);

  if (format === 'json') {
    return {
      data: JSON.stringify(positions, null, 2),
      contentType: 'application/json',
      filename: `positions-${dateStamp()}.json`,
    };
  }

  const columns: CsvColumn<typeof positions[0]>[] = [
    { header: 'Address', accessor: r => r.address },
    { header: 'Label', accessor: r => r.label },
    { header: 'Chain ID', accessor: r => r.chainId },
    { header: 'Orchestrator', accessor: r => r.orchestrator },
    { header: 'Staked Amount', accessor: r => r.stakedAmount },
    { header: 'Pending Rewards', accessor: r => r.pendingRewards },
    { header: 'Pending Fees', accessor: r => r.pendingFees },
    { header: 'Reward Cut (%)', accessor: r => r.orchestratorInfo ? (r.orchestratorInfo.rewardCut / 10000).toFixed(2) : '' },
    { header: 'Fee Share (%)', accessor: r => r.orchestratorInfo ? (r.orchestratorInfo.feeShare / 10000).toFixed(2) : '' },
    { header: 'Start Round', accessor: r => r.startRound },
  ];

  return {
    data: buildCsv(positions, columns),
    contentType: 'text/csv',
    filename: `positions-${dateStamp()}.csv`,
  };
}

function dateStamp(): string {
  return new Date().toISOString().slice(0, 10);
}
