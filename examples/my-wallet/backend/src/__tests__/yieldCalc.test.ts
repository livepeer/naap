import { describe, it, expect } from 'vitest';
import { calculateYield, parsePeriod, type Snapshot } from '../lib/yieldCalc.js';

describe('parsePeriod', () => {
  it('parses 7d', () => {
    expect(parsePeriod('7d')).toBe(7);
  });

  it('parses 30d', () => {
    expect(parsePeriod('30d')).toBe(30);
  });

  it('parses 90d', () => {
    expect(parsePeriod('90d')).toBe(90);
  });

  it('parses ytd to positive number of days', () => {
    const days = parsePeriod('ytd');
    expect(days).toBeGreaterThan(0);
    expect(days).toBeLessThanOrEqual(366);
  });

  it('defaults to 30 for unknown period', () => {
    expect(parsePeriod('unknown')).toBe(30);
    expect(parsePeriod('')).toBe(30);
  });
});

describe('calculateYield', () => {
  const makeSnapshot = (
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

  it('returns zeros for empty snapshots', () => {
    const result = calculateYield([], 30);
    expect(result.rewardYield).toBe(0);
    expect(result.feeYield).toBe(0);
    expect(result.combinedApy).toBe(0);
    expect(result.dataPoints).toBe(0);
    expect(result.chart).toEqual([]);
  });

  it('returns zeros for single snapshot', () => {
    const result = calculateYield(
      [makeSnapshot('1000000000000000000', '100000000000000000', '10000000000000000', 0, 100)],
      30,
    );
    expect(result.rewardYield).toBe(0);
    expect(result.dataPoints).toBe(1);
  });

  it('returns zeros when startBonded is zero', () => {
    const result = calculateYield(
      [
        makeSnapshot('0', '0', '0', 30, 100),
        makeSnapshot('0', '100', '10', 0, 130),
      ],
      30,
    );
    expect(result.rewardYield).toBe(0);
    expect(result.feeYield).toBe(0);
  });

  it('calculates positive yield correctly', () => {
    // 1000 LPT bonded, pending stake goes from 0 to 100 over 30 days
    const bonded = '1000000000000000000000'; // 1000 * 1e18
    const result = calculateYield(
      [
        makeSnapshot(bonded, '0', '0', 30, 100),
        makeSnapshot(bonded, '100000000000000000000', '10000000000000000000', 0, 130),
      ],
      30,
    );
    // Reward: 100/1000 = 10% over 30 days → 10% * (365/30) ≈ 121.6667%
    expect(result.rewardYield).toBeCloseTo(121.6667, 1);
    // Fee: 10/1000 = 1% over 30 days → 1% * (365/30) ≈ 12.1667%
    expect(result.feeYield).toBeCloseTo(12.1667, 1);
    expect(result.combinedApy).toBeCloseTo(133.8333, 1);
    expect(result.dataPoints).toBe(2);
  });

  it('builds chart with cumulative yields', () => {
    const bonded = '1000000000000000000000';
    const snapshots = [
      makeSnapshot(bonded, '0', '0', 30, 100),
      makeSnapshot(bonded, '50000000000000000000', '5000000000000000000', 15, 115),
      makeSnapshot(bonded, '100000000000000000000', '10000000000000000000', 0, 130),
    ];
    const result = calculateYield(snapshots, 30);
    expect(result.chart).toHaveLength(3);
    // First chart point should be zero (baseline)
    expect(result.chart[0].cumulativeRewardYield).toBe(0);
    // Mid-point should be ~5%
    expect(result.chart[1].cumulativeRewardYield).toBe(5);
    // Last should be ~10%
    expect(result.chart[2].cumulativeRewardYield).toBe(10);
  });

  it('sorts snapshots by date', () => {
    const bonded = '1000000000000000000000';
    // Pass in reverse order
    const result = calculateYield(
      [
        makeSnapshot(bonded, '100000000000000000000', '0', 0, 130),
        makeSnapshot(bonded, '0', '0', 30, 100),
      ],
      30,
    );
    // Should still compute positive yield (not negative)
    expect(result.rewardYield).toBeGreaterThan(0);
  });
});
