/**
 * Pure yield calculation functions
 * Computes annualized yield from staking snapshots
 */

function safeBigInt(val: string | undefined | null): string {
  if (!val || val === '0') return '0';
  const dotIdx = val.indexOf('.');
  return dotIdx >= 0 ? (val.slice(0, dotIdx) || '0') : val;
}

export interface Snapshot {
  bondedAmount: string;
  pendingStake: string;
  pendingFees: string;
  round: number;
  snapshotAt: string;
}

export interface YieldResult {
  rewardYield: number;    // annualized % from staking rewards
  feeYield: number;       // annualized % from fees
  combinedApy: number;    // combined annualized %
  periodDays: number;
  dataPoints: number;
  chart: YieldChartPoint[];
}

export interface YieldChartPoint {
  date: string;
  round: number;
  cumulativeRewardYield: number;
  cumulativeFeeYield: number;
  cumulativeCombined: number;
}

/**
 * Parse period string to number of days
 */
export function parsePeriod(period: string): number {
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

/**
 * Calculate yield from an array of snapshots (sorted oldest→newest)
 */
export function calculateYield(snapshots: Snapshot[], periodDays: number): YieldResult {
  if (snapshots.length < 2) {
    return {
      rewardYield: 0,
      feeYield: 0,
      combinedApy: 0,
      periodDays,
      dataPoints: snapshots.length,
      chart: [],
    };
  }

  const sorted = [...snapshots].sort(
    (a, b) => new Date(a.snapshotAt).getTime() - new Date(b.snapshotAt).getTime()
  );

  const first = sorted[0];
  const last = sorted[sorted.length - 1];

  const startBonded = BigInt(safeBigInt(first.bondedAmount));
  if (startBonded === 0n) {
    return {
      rewardYield: 0,
      feeYield: 0,
      combinedApy: 0,
      periodDays,
      dataPoints: sorted.length,
      chart: [],
    };
  }

  const stakeGain = BigInt(safeBigInt(last.pendingStake)) - BigInt(safeBigInt(first.pendingStake));
  const feeGain = BigInt(safeBigInt(last.pendingFees)) - BigInt(safeBigInt(first.pendingFees));

  // Use basis points for precision (1e8)
  const PRECISION = 100_000_000n;
  const rewardBps = (stakeGain * PRECISION) / startBonded;
  const feeBps = (feeGain * PRECISION) / startBonded;

  const rewardPeriod = Number(rewardBps) / Number(PRECISION);
  const feePeriod = Number(feeBps) / Number(PRECISION);

  const annualizeFactor = 365 / Math.max(1, periodDays);
  const rewardYield = rewardPeriod * annualizeFactor * 100;
  const feeYield = feePeriod * annualizeFactor * 100;
  const combinedApy = (rewardPeriod + feePeriod) * annualizeFactor * 100;

  // Build chart points
  const chart: YieldChartPoint[] = sorted.map((snap) => {
    const sg = BigInt(snap.pendingStake || '0') - BigInt(first.pendingStake || '0');
    const fg = BigInt(snap.pendingFees || '0') - BigInt(first.pendingFees || '0');
    const rYield = Number((sg * PRECISION) / startBonded) / Number(PRECISION) * 100;
    const fYield = Number((fg * PRECISION) / startBonded) / Number(PRECISION) * 100;

    return {
      date: snap.snapshotAt,
      round: snap.round,
      cumulativeRewardYield: parseFloat(rYield.toFixed(4)),
      cumulativeFeeYield: parseFloat(fYield.toFixed(4)),
      cumulativeCombined: parseFloat((rYield + fYield).toFixed(4)),
    };
  });

  return {
    rewardYield: parseFloat(rewardYield.toFixed(4)),
    feeYield: parseFloat(feeYield.toFixed(4)),
    combinedApy: parseFloat(combinedApy.toFixed(4)),
    periodDays,
    dataPoints: sorted.length,
    chart,
  };
}
