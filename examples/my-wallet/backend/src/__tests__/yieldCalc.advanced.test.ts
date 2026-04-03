import { describe, it, expect } from 'vitest';
import { calculateYield, type Snapshot } from '../lib/yieldCalc.js';

describe('calculateYield - advanced scenarios', () => {
  const snap = (
    bondedAmount: string,
    pendingStake: string,
    pendingFees: string,
    daysAgo: number,
    round: number,
  ): Snapshot => ({
    bondedAmount,
    pendingStake,
    pendingFees,
    round,
    snapshotAt: new Date(Date.now() - daysAgo * 86400000).toISOString(),
  });

  it('handles very small yield (dust amounts)', () => {
    const bonded = '1000000000000000000000000'; // 1M LPT in wei
    const result = calculateYield(
      [
        snap(bonded, '0', '0', 90, 100),
        snap(bonded, '1000000000000', '0', 0, 190), // very small reward
      ],
      90,
    );
    expect(result.rewardYield).toBeGreaterThanOrEqual(0);
    expect(result.rewardYield).toBeLessThan(1);
  });

  it('handles negative yield (pending decreases)', () => {
    const bonded = '1000000000000000000000';
    const result = calculateYield(
      [
        snap(bonded, '100000000000000000000', '0', 30, 100),
        snap(bonded, '50000000000000000000', '0', 0, 130),
      ],
      30,
    );
    // Negative yield should be reported
    expect(result.rewardYield).toBeLessThan(0);
  });

  it('handles multiple snapshots building chart correctly', () => {
    const bonded = '1000000000000000000000'; // 1000 LPT
    const snapshots = Array.from({ length: 10 }, (_, i) =>
      snap(
        bonded,
        (BigInt(i) * 10000000000000000000n).toString(), // 0, 10, 20, ..., 90 LPT
        '0',
        90 - i * 10,
        100 + i,
      ),
    );
    const result = calculateYield(snapshots, 90);
    expect(result.chart).toHaveLength(10);
    // Chart should be monotonically increasing
    for (let i = 1; i < result.chart.length; i++) {
      expect(result.chart[i].cumulativeRewardYield).toBeGreaterThanOrEqual(
        result.chart[i - 1].cumulativeRewardYield,
      );
    }
  });

  it('annualizes correctly for 7-day period', () => {
    const bonded = '1000000000000000000000';
    const reward7d = calculateYield(
      [
        snap(bonded, '0', '0', 7, 100),
        snap(bonded, '10000000000000000000', '0', 0, 107),
      ],
      7,
    );
    const reward30d = calculateYield(
      [
        snap(bonded, '0', '0', 30, 100),
        snap(bonded, '10000000000000000000', '0', 0, 130),
      ],
      30,
    );
    // Same absolute gain but 7d annualization factor is higher
    expect(reward7d.rewardYield).toBeGreaterThan(reward30d.rewardYield);
  });

  it('handles fee-only yield', () => {
    const bonded = '1000000000000000000000';
    const result = calculateYield(
      [
        snap(bonded, '0', '0', 30, 100),
        snap(bonded, '0', '50000000000000000000', 0, 130),
      ],
      30,
    );
    expect(result.rewardYield).toBe(0);
    expect(result.feeYield).toBeGreaterThan(0);
    expect(result.combinedApy).toEqual(result.feeYield);
  });

  it('combined = reward + fee yield', () => {
    const bonded = '1000000000000000000000';
    const result = calculateYield(
      [
        snap(bonded, '0', '0', 30, 100),
        snap(bonded, '100000000000000000000', '50000000000000000000', 0, 130),
      ],
      30,
    );
    expect(result.combinedApy).toBeCloseTo(result.rewardYield + result.feeYield, 2);
  });
});
