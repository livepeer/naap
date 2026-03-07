/**
 * P&L calculation and export service
 * S13: Comprehensive P&L with cost basis, rewards, fees, gas
 */

import { prisma } from '../db/client.js';
import { buildCsv, type CsvColumn } from './csvBuilder.js';

export interface PnlRow {
  address: string;
  orchestrator: string;
  bondedAmount: string;
  totalRewardsEarned: string;
  totalFeesEarned: string;
  totalGasCostEth: string;
  netReturnLpt: string;
  netReturnPct: number;
  periodStart: string;
  periodEnd: string;
}

export interface PnlSummary {
  rows: PnlRow[];
  totals: {
    totalBonded: string;
    totalRewards: string;
    totalFees: string;
    totalGas: string;
    netReturn: string;
  };
}

/**
 * Calculate P&L for a user over a time range
 */
export async function calculatePnl(
  userId: string,
  startDate?: Date,
  endDate?: Date,
): Promise<PnlSummary> {
  const now = endDate || new Date();
  const start = startDate || new Date(now.getTime() - 365 * 86400000);

  const addresses = await prisma.walletAddress.findMany({
    where: { userId },
    include: {
      stakingStates: true,
      transactions: {
        where: {
          status: 'confirmed',
          timestamp: { gte: start, lte: now },
        },
        select: { type: true, value: true, gasUsed: true, gasPrice: true },
      },
    },
  });

  const rows: PnlRow[] = [];
  let totalBonded = 0n;
  let totalRewards = 0n;
  let totalFees = 0n;
  let totalGas = 0n;

  for (const addr of addresses) {
    for (const state of addr.stakingStates) {
      const bonded = BigInt(state.stakedAmount || '0');
      const rewards = BigInt(state.pendingRewards || '0');
      const fees = BigInt(state.pendingFees || '0');

      // Sum gas costs for this address
      let addrGas = 0n;
      for (const tx of addr.transactions) {
        const gasUsed = BigInt(tx.gasUsed || '0');
        const gasPrice = BigInt(tx.gasPrice || '0');
        addrGas += gasUsed * gasPrice;
      }

      const netReturn = rewards + fees; // in LPT wei
      const netPct = bonded > 0n
        ? parseFloat(((Number(netReturn) / Number(bonded)) * 100).toFixed(4))
        : 0;

      rows.push({
        address: addr.address,
        orchestrator: state.delegatedTo || 'Unknown',
        bondedAmount: bonded.toString(),
        totalRewardsEarned: rewards.toString(),
        totalFeesEarned: fees.toString(),
        totalGasCostEth: (Number(addrGas) / 1e18).toFixed(8),
        netReturnLpt: netReturn.toString(),
        netReturnPct: netPct,
        periodStart: start.toISOString(),
        periodEnd: now.toISOString(),
      });

      totalBonded += bonded;
      totalRewards += rewards;
      totalFees += fees;
      totalGas += addrGas;
    }
  }

  return {
    rows,
    totals: {
      totalBonded: totalBonded.toString(),
      totalRewards: totalRewards.toString(),
      totalFees: totalFees.toString(),
      totalGas: (Number(totalGas) / 1e18).toFixed(8),
      netReturn: (totalRewards + totalFees).toString(),
    },
  };
}

/**
 * Export P&L as CSV
 */
export function pnlToCsv(pnl: PnlSummary): string {
  const columns: CsvColumn<PnlRow>[] = [
    { header: 'Address', accessor: r => r.address },
    { header: 'Orchestrator', accessor: r => r.orchestrator },
    { header: 'Bonded (wei)', accessor: r => r.bondedAmount },
    { header: 'Rewards Earned (wei)', accessor: r => r.totalRewardsEarned },
    { header: 'Fees Earned (wei)', accessor: r => r.totalFeesEarned },
    { header: 'Gas Cost (ETH)', accessor: r => r.totalGasCostEth },
    { header: 'Net Return (wei)', accessor: r => r.netReturnLpt },
    { header: 'Net Return %', accessor: r => r.netReturnPct },
    { header: 'Period Start', accessor: r => r.periodStart },
    { header: 'Period End', accessor: r => r.periodEnd },
  ];
  return buildCsv(pnl.rows, columns);
}
