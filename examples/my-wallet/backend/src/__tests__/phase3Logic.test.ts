/**
 * Phase 3 pure logic tests — simulator math, risk grading, gas aggregation
 */

import { describe, it, expect } from 'vitest';

// ─── Simulator Math ────────────────────────────────────────────────
describe('Simulator yield calculations', () => {
  const baselineApr = 0.12;

  function calcYieldDelta(fromRewardCut: number, toRewardCut: number): number {
    const fromDelegatorPct = (100 - fromRewardCut) / 100;
    const toDelegatorPct = (100 - toRewardCut) / 100;
    return (baselineApr * toDelegatorPct * 100) - (baselineApr * fromDelegatorPct * 100);
  }

  function calcOpportunityCost(amountLpt: number, toRewardCut: number, unbondingDays: number): number {
    const toDelegatorPct = (100 - toRewardCut) / 100;
    return (amountLpt * baselineApr * toDelegatorPct / 365) * unbondingDays;
  }

  function calcNetBenefit(amountLpt: number, yieldDelta: number, opportunityCost: number): number {
    return amountLpt * (yieldDelta / 100) - opportunityCost;
  }

  function getRecommendation(netBenefit: number, opportunityCost: number) {
    if (netBenefit > opportunityCost) return 'favorable';
    if (netBenefit > 0) return 'neutral';
    return 'unfavorable';
  }

  it('should return 0 yield delta for identical reward cuts', () => {
    expect(calcYieldDelta(10, 10)).toBe(0);
  });

  it('should show positive delta when moving to lower reward cut', () => {
    const delta = calcYieldDelta(20, 10);
    expect(delta).toBeGreaterThan(0);
    expect(delta).toBeCloseTo(1.2, 4); // 12% * (0.9 - 0.8) * 100
  });

  it('should show negative delta when moving to higher reward cut', () => {
    expect(calcYieldDelta(10, 20)).toBeLessThan(0);
  });

  it('should calculate opportunity cost based on unbonding period', () => {
    const cost = calcOpportunityCost(10000, 10, 7);
    // 10000 * 0.12 * 0.9 / 365 * 7 ≈ 20.71
    expect(cost).toBeCloseTo(20.71, 1);
  });

  it('should have zero opportunity cost with 0 unbonding days', () => {
    expect(calcOpportunityCost(10000, 10, 0)).toBe(0);
  });

  it('should recommend favorable when net benefit > opportunity cost', () => {
    expect(getRecommendation(100, 20)).toBe('favorable');
  });

  it('should recommend neutral when 0 < net benefit < opportunity cost', () => {
    expect(getRecommendation(5, 20)).toBe('neutral');
  });

  it('should recommend unfavorable when net benefit <= 0', () => {
    expect(getRecommendation(-10, 20)).toBe('unfavorable');
    expect(getRecommendation(0, 20)).toBe('unfavorable');
  });

  it('should compute correct net benefit', () => {
    const yieldDelta = calcYieldDelta(20, 10); // +1.2%
    const cost = calcOpportunityCost(10000, 10, 7); // ~20.71
    const net = calcNetBenefit(10000, yieldDelta, cost);
    // annual gain = 10000 * 1.2 / 100 = 120
    // net = 120 - 20.71 = 99.29
    expect(net).toBeCloseTo(99.29, 0);
  });
});

// ─── Risk Score Grading ────────────────────────────────────────────
describe('Risk score grading', () => {
  function getGrade(score: number): 'A' | 'B' | 'C' | 'D' | 'F' {
    if (score >= 85) return 'A';
    if (score >= 70) return 'B';
    if (score >= 55) return 'C';
    if (score >= 40) return 'D';
    return 'F';
  }

  it('should grade A for score >= 85', () => {
    expect(getGrade(85)).toBe('A');
    expect(getGrade(100)).toBe('A');
  });

  it('should grade B for 70-84', () => {
    expect(getGrade(70)).toBe('B');
    expect(getGrade(84)).toBe('B');
  });

  it('should grade C for 55-69', () => {
    expect(getGrade(55)).toBe('C');
    expect(getGrade(69)).toBe('C');
  });

  it('should grade D for 40-54', () => {
    expect(getGrade(40)).toBe('D');
    expect(getGrade(54)).toBe('D');
  });

  it('should grade F for < 40', () => {
    expect(getGrade(39)).toBe('F');
    expect(getGrade(0)).toBe('F');
  });
});

// ─── Stake Concentration Factor ────────────────────────────────────
describe('Stake concentration scoring', () => {
  function stakeConcentrationScore(totalStakeLpt: number): number {
    if (totalStakeLpt > 100000) return 25;
    if (totalStakeLpt > 50000) return 20;
    if (totalStakeLpt > 10000) return 15;
    if (totalStakeLpt > 1000) return 10;
    return 5;
  }

  it('should return 25 for very high stake', () => {
    expect(stakeConcentrationScore(200000)).toBe(25);
  });

  it('should return 5 for very low stake', () => {
    expect(stakeConcentrationScore(500)).toBe(5);
  });

  it('should return 15 for mid-tier stake', () => {
    expect(stakeConcentrationScore(20000)).toBe(15);
  });
});

// ─── Tenure Factor ─────────────────────────────────────────────────
describe('Tenure scoring', () => {
  function tenureScore(ageDays: number): number {
    if (ageDays > 365) return 25;
    if (ageDays > 180) return 20;
    if (ageDays > 90) return 15;
    if (ageDays > 30) return 10;
    return 5;
  }

  it('should return 25 for orchestrators > 1 year old', () => {
    expect(tenureScore(400)).toBe(25);
  });

  it('should return 5 for new orchestrators < 30 days', () => {
    expect(tenureScore(10)).toBe(5);
  });
});

// ─── Fee Share Stability ───────────────────────────────────────────
describe('Fee share stability scoring', () => {
  function feeShareStabilityScore(totalChanges: number, hasEnoughData: boolean): number {
    if (!hasEnoughData) return 15;
    if (totalChanges > 10) return 5;
    if (totalChanges > 5) return 15;
    if (totalChanges > 0) return 20;
    return 25;
  }

  it('should return 25 for no changes', () => {
    expect(feeShareStabilityScore(0, true)).toBe(25);
  });

  it('should return 5 for frequent changes', () => {
    expect(feeShareStabilityScore(15, true)).toBe(5);
  });

  it('should return 15 for insufficient data', () => {
    expect(feeShareStabilityScore(0, false)).toBe(15);
  });
});

// ─── Gas Aggregation Logic ─────────────────────────────────────────
describe('Gas aggregation logic', () => {
  function aggregateGas(transactions: Array<{ type: string; gasUsed: string; gasPrice: string }>) {
    let totalGasUsed = 0n;
    let totalGasCostWei = 0n;
    const byType: Record<string, { count: number; totalGasWei: bigint }> = {};

    for (const tx of transactions) {
      const gasUsed = BigInt(tx.gasUsed);
      const gasPrice = BigInt(tx.gasPrice);
      const cost = gasUsed * gasPrice;
      totalGasUsed += gasUsed;
      totalGasCostWei += cost;

      if (!byType[tx.type]) byType[tx.type] = { count: 0, totalGasWei: 0n };
      byType[tx.type].count++;
      byType[tx.type].totalGasWei += cost;
    }

    const txCount = transactions.length;
    return {
      totalGasUsed: totalGasUsed.toString(),
      totalGasCostWei: totalGasCostWei.toString(),
      totalGasCostEth: Number(totalGasCostWei) / 1e18,
      transactionCount: txCount,
      avgGasPerTx: txCount > 0 ? Number(totalGasUsed) / txCount : 0,
      byType,
    };
  }

  it('should handle empty transaction list', () => {
    const result = aggregateGas([]);
    expect(result.totalGasUsed).toBe('0');
    expect(result.transactionCount).toBe(0);
    expect(result.avgGasPerTx).toBe(0);
  });

  it('should correctly aggregate gas for multiple transactions', () => {
    const result = aggregateGas([
      { type: 'stake', gasUsed: '21000', gasPrice: '20000000000' },
      { type: 'stake', gasUsed: '42000', gasPrice: '20000000000' },
      { type: 'claim', gasUsed: '30000', gasPrice: '10000000000' },
    ]);

    expect(result.transactionCount).toBe(3);
    expect(result.avgGasPerTx).toBe(31000);
    expect(result.byType['stake'].count).toBe(2);
    expect(result.byType['claim'].count).toBe(1);
  });

  it('should compute gas cost correctly using BigInt', () => {
    const result = aggregateGas([
      { type: 'transfer', gasUsed: '21000', gasPrice: '50000000000' },
    ]);
    // 21000 * 50 gwei = 1,050,000 gwei = 0.00000105 ETH
    expect(result.totalGasCostWei).toBe('1050000000000000');
    expect(result.totalGasCostEth).toBeCloseTo(0.00105, 5);
  });

  it('should group by transaction type', () => {
    const result = aggregateGas([
      { type: 'stake', gasUsed: '100', gasPrice: '1' },
      { type: 'unstake', gasUsed: '200', gasPrice: '1' },
      { type: 'stake', gasUsed: '300', gasPrice: '1' },
    ]);
    expect(Object.keys(result.byType)).toHaveLength(2);
    expect(result.byType['stake'].count).toBe(2);
    expect(result.byType['stake'].totalGasWei).toBe(400n);
    expect(result.byType['unstake'].count).toBe(1);
  });
});

// ─── AI Recommendation Scoring ─────────────────────────────────────
describe('AI recommendation scoring', () => {
  function scoreOrchestrator(
    rewardCut: number,
    feeShare: number,
    totalStakeLpt: number,
    isActive: boolean,
    riskTolerance: 'conservative' | 'moderate' | 'aggressive',
  ): number {
    let score = 0;

    // Reward cut: lower is better for delegator
    score += Math.max(0, 30 - rewardCut);

    // Fee share: higher is better for delegator
    score += Math.min(25, feeShare / 4);

    // Stake: moderate stake preferred
    if (totalStakeLpt > 10000 && totalStakeLpt < 200000) score += 20;
    else if (totalStakeLpt > 5000) score += 15;
    else score += 5;

    // Risk tolerance adjustments
    if (riskTolerance === 'conservative') {
      if (totalStakeLpt > 50000) score += 10;
    } else if (riskTolerance === 'aggressive') {
      if (totalStakeLpt < 20000) score += 10; // smaller Os may have lower cuts
    }

    if (!isActive) score -= 50;

    return Math.max(0, Math.min(100, score));
  }

  it('should penalize inactive orchestrators heavily', () => {
    const active = scoreOrchestrator(10, 80, 50000, true, 'moderate');
    const inactive = scoreOrchestrator(10, 80, 50000, false, 'moderate');
    expect(inactive).toBeLessThan(active - 30);
  });

  it('should prefer lower reward cuts', () => {
    const lowCut = scoreOrchestrator(5, 50, 50000, true, 'moderate');
    const highCut = scoreOrchestrator(25, 50, 50000, true, 'moderate');
    expect(lowCut).toBeGreaterThan(highCut);
  });

  it('should cap score at 100', () => {
    const score = scoreOrchestrator(0, 100, 100000, true, 'conservative');
    expect(score).toBeLessThanOrEqual(100);
  });

  it('should floor score at 0', () => {
    const score = scoreOrchestrator(30, 0, 100, false, 'moderate');
    expect(score).toBe(0);
  });
});
