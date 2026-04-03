/**
 * Historical network analytics service
 * S21: Time-series data for network-level metrics
 */

import { prisma } from '../db/client.js';

export interface NetworkHistoryPoint {
  round: number;
  totalBonded: string;
  participationRate: number;
  inflation: string;
  activeOrchestrators: number;
  avgRewardCut: number;
  avgFeeShare: number;
  snapshotAt: string;
}

export interface NetworkTrends {
  dataPoints: NetworkHistoryPoint[];
  summary: {
    bondedChange: string;
    participationChange: number;
    orchestratorCountChange: number;
    periodStart: string;
    periodEnd: string;
  };
}

/**
 * Get network history for a time range
 */
export async function getNetworkHistory(
  limit = 90,
  startDate?: Date,
): Promise<NetworkTrends> {
  const where = startDate ? { snapshotAt: { gte: startDate } } : {};

  const snapshots = await prisma.walletNetworkSnapshot.findMany({
    where,
    orderBy: { round: 'asc' },
    take: limit,
  });

  const dataPoints: NetworkHistoryPoint[] = snapshots.map(s => ({
    round: s.round,
    totalBonded: s.totalBonded,
    participationRate: s.participationRate,
    inflation: s.inflation,
    activeOrchestrators: s.activeOrchestrators,
    avgRewardCut: s.avgRewardCut,
    avgFeeShare: s.avgFeeShare,
    snapshotAt: s.snapshotAt.toISOString(),
  }));

  // Calculate trends
  const first = snapshots[0];
  const last = snapshots[snapshots.length - 1];
  let bondedChange = '0';
  let participationChange = 0;
  let orchestratorCountChange = 0;

  if (first && last) {
    const startBonded = BigInt(first.totalBonded || '0');
    const endBonded = BigInt(last.totalBonded || '0');
    bondedChange = (endBonded - startBonded).toString();
    participationChange = parseFloat((last.participationRate - first.participationRate).toFixed(2));
    orchestratorCountChange = last.activeOrchestrators - first.activeOrchestrators;
  }

  return {
    dataPoints,
    summary: {
      bondedChange,
      participationChange,
      orchestratorCountChange,
      periodStart: first?.snapshotAt.toISOString() || new Date().toISOString(),
      periodEnd: last?.snapshotAt.toISOString() || new Date().toISOString(),
    },
  };
}

/**
 * Record network snapshot (called by cron job)
 */
export async function recordNetworkSnapshot(
  round: number,
  totalBonded: string,
  participationRate: number,
  inflation: string,
  activeOrchestrators: number,
  avgRewardCut: number,
  avgFeeShare: number,
): Promise<void> {
  await prisma.walletNetworkSnapshot.upsert({
    where: { round },
    update: { totalBonded, participationRate, inflation, activeOrchestrators, avgRewardCut, avgFeeShare },
    create: { round, totalBonded, participationRate, inflation, activeOrchestrators, avgRewardCut, avgFeeShare },
  });
}
