/**
 * Export formatting (CSV/JSON) for leaderboard and positions
 */

import { prisma } from '../db/client.js';
import { buildCsv, CsvColumn } from './csvBuilder.js';
import { getPositions } from './portfolioService.js';

export type ExportFormat = 'csv' | 'json';

/**
 * Export orchestrator leaderboard
 */
export async function exportLeaderboard(format: ExportFormat): Promise<{ data: string; contentType: string; filename: string }> {
  const orchestrators = await prisma.walletOrchestrator.findMany({
    where: { isActive: true },
    orderBy: { totalStake: 'desc' },
  });

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
