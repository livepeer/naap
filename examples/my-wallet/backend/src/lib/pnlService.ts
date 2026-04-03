/**
 * P&L calculation service — computed from on-chain staking data
 * No database required: uses Livepeer subgraph/RPC data
 */

import { getDelegator, getStakingHistory, getPrices, getProtocol, estimateDailyReward, type StakingEvent } from './livepeer.js';
import { buildCsv, type CsvColumn } from './csvBuilder.js';
import { prisma } from '../db/client.js';

export interface PnlRow {
  address: string;
  orchestrator: string;
  totalStaked: string;       // Current total stake (LPT, human-readable)
  principal: string;         // Original bonded amount
  accumulatedRewards: string; // Rewards earned
  pendingFees: string;       // ETH fees
  dailyRewardRate: string;   // LPT per day
  roundsElapsed: number;
  annualizedAPR: string;     // Percentage
  periodStart: string;
  periodEnd: string;
}

export interface PnlSummary {
  rows: PnlRow[];
  totals: {
    totalStaked: string;
    totalPrincipal: string;
    totalRewards: string;
    totalFees: string;
    avgDailyReward: string;
    avgAPR: string;
  };
  prices: {
    lptUsd: number;
    ethUsd: number;
  };
  stakingEvents: StakingEvent[];
}

/**
 * Calculate P&L for an address using on-chain data
 */
export async function calculatePnl(
  address: string,
  startDate?: Date,
  endDate?: Date,
): Promise<PnlSummary> {
  const addr = address.toLowerCase();
  const now = endDate || new Date();
  const start = startDate || new Date(now.getTime() - 365 * 86400000);

  const [delegator, protocol, prices, events, rewardEstimate] = await Promise.all([
    getDelegator(addr),
    getProtocol(),
    getPrices(),
    getStakingHistory(addr),
    estimateDailyReward(addr),
  ]);

  const rows: PnlRow[] = [];
  let totalStaked = 0;
  let totalPrincipal = 0;
  let totalRewards = 0;
  let totalFees = 0;
  let totalDailyReward = 0;
  let aprSum = 0;

  // Try snapshot-based P&L when date range is provided
  let usedSnapshots = false;
  if (startDate && delegator && delegator.bondedAmount !== '0') {
    try {
      const snapshots = await prisma.walletStakingSnapshot.findMany({
        where: {
          address: addr,
          createdAt: { gte: start, lte: now },
        },
        orderBy: { createdAt: 'asc' },
      });

      if (snapshots.length >= 2) {
        const earliest = snapshots[0];
        const latest = snapshots[snapshots.length - 1];
        const periodReward = (BigInt(latest.pendingStake) - BigInt(earliest.pendingStake));
        const periodDays = (latest.createdAt.getTime() - earliest.createdAt.getTime()) / 86400000;
        const staked = parseFloat(latest.pendingStake) / 1e18;
        const principal = parseFloat(latest.bondedAmount) / 1e18;
        const accumulated = Number(periodReward) / 1e18;
        const fees = parseFloat(latest.pendingFees) / 1e18;
        const dailyReward = periodDays > 0 ? accumulated / periodDays : 0;
        const apr = principal > 0 && periodDays > 0
          ? (accumulated / principal) * (365 / periodDays) * 100
          : 0;

        rows.push({
          address: addr,
          orchestrator: latest.orchestrator || delegator.delegateAddress || 'None',
          totalStaked: staked.toFixed(4),
          principal: principal.toFixed(4),
          accumulatedRewards: accumulated.toFixed(4),
          pendingFees: fees.toFixed(8),
          dailyRewardRate: dailyReward.toFixed(4),
          roundsElapsed: latest.round - earliest.round,
          annualizedAPR: apr.toFixed(2),
          periodStart: earliest.createdAt.toISOString(),
          periodEnd: latest.createdAt.toISOString(),
        });

        totalStaked += staked;
        totalPrincipal += principal;
        totalRewards += accumulated;
        totalFees += fees;
        totalDailyReward += dailyReward;
        aprSum += apr;
        usedSnapshots = true;
      }
    } catch {
      // Snapshots unavailable — fall through to live-only
    }
  }

  // Fall back to live-only P&L
  if (!usedSnapshots && delegator && delegator.bondedAmount !== '0') {
    const staked = parseFloat(delegator.bondedAmount) / 1e18;
    let principal = parseFloat(delegator.principal || '0') / 1e18;
    const fees = parseFloat(delegator.fees || '0') / 1e18;

    // When principal is missing or zero (RPC fallback), estimate from reward data
    if (principal <= 0 && staked > 0 && rewardEstimate.dailyRewardLpt > 0) {
      const estimatedTotalRewards = rewardEstimate.dailyRewardLpt * 365;
      principal = Math.max(staked - estimatedTotalRewards, staked * 0.9);
    } else if (principal <= 0 && staked > 0) {
      principal = staked;
    }
    const accumulated = staked - principal;
    const currentRound = protocol.currentRound;
    const lastClaimRound = parseInt(delegator.lastClaimRound || '0');
    const roundsElapsed = currentRound - lastClaimRound;
    // Use observed rate if available, otherwise backend estimate
    const dailyReward = (accumulated > 0 && roundsElapsed > 0)
      ? accumulated / roundsElapsed
      : rewardEstimate.dailyRewardLpt;
    const apr = (accumulated > 0 && roundsElapsed > 0 && principal > 0)
      ? (accumulated / principal) * (365 / roundsElapsed) * 100
      : rewardEstimate.apr;

    rows.push({
      address: addr,
      orchestrator: delegator.delegateAddress || 'None',
      totalStaked: staked.toFixed(4),
      principal: principal.toFixed(4),
      accumulatedRewards: accumulated.toFixed(4),
      pendingFees: fees.toFixed(8),
      dailyRewardRate: dailyReward.toFixed(4),
      roundsElapsed,
      annualizedAPR: apr.toFixed(2),
      periodStart: start.toISOString(),
      periodEnd: now.toISOString(),
    });

    totalStaked += staked;
    totalPrincipal += principal;
    totalRewards += accumulated;
    totalFees += fees;
    totalDailyReward += dailyReward;
    aprSum += apr;
  }

  // Filter events by time period
  const startTs = Math.floor(start.getTime() / 1000);
  const endTs = Math.floor(now.getTime() / 1000);
  const filteredEvents = events.filter(e => {
    if (e.timestamp <= 0) return true; // state-derived events have no real timestamp
    return e.timestamp >= startTs && e.timestamp <= endTs;
  });

  return {
    rows,
    totals: {
      totalStaked: totalStaked.toFixed(4),
      totalPrincipal: totalPrincipal.toFixed(4),
      totalRewards: totalRewards.toFixed(4),
      totalFees: totalFees.toFixed(8),
      avgDailyReward: totalDailyReward.toFixed(4),
      avgAPR: aprSum.toFixed(2),
    },
    prices: {
      lptUsd: prices.lptUsd,
      ethUsd: prices.ethUsd,
    },
    stakingEvents: filteredEvents,
  };
}

/**
 * Export P&L as CSV
 */
export function pnlToCsv(pnl: PnlSummary): string {
  const columns: CsvColumn<PnlRow>[] = [
    { header: 'Address', accessor: r => r.address },
    { header: 'Orchestrator', accessor: r => r.orchestrator },
    { header: 'Total Staked (LPT)', accessor: r => r.totalStaked },
    { header: 'Principal (LPT)', accessor: r => r.principal },
    { header: 'Rewards Earned (LPT)', accessor: r => r.accumulatedRewards },
    { header: 'Pending Fees (ETH)', accessor: r => r.pendingFees },
    { header: 'Daily Reward Rate (LPT)', accessor: r => r.dailyRewardRate },
    { header: 'Rounds Elapsed', accessor: r => r.roundsElapsed },
    { header: 'Annualized APR %', accessor: r => r.annualizedAPR },
    { header: 'Period Start', accessor: r => r.periodStart },
    { header: 'Period End', accessor: r => r.periodEnd },
  ];
  return buildCsv(pnl.rows, columns);
}
