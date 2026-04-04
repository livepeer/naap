import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../db/client.js', () => ({ prisma: {} }));

vi.mock('../lib/livepeer.js', () => ({
  getOrchestrators: vi.fn(),
  getPrices: vi.fn(),
  getProtocol: vi.fn(),
}));

import { getOrchestrators, getPrices, getProtocol } from '../lib/livepeer.js';
import type { MultiOInput } from '../lib/multiOSimulatorService.js';

const mockGetOrchestrators = vi.mocked(getOrchestrators);
const mockGetPrices = vi.mocked(getPrices);
const mockGetProtocol = vi.mocked(getProtocol);

function makeOrchestrators(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    address: `0x${(i + 1).toString().padStart(40, '0')}`,
    active: true,
    totalStake: (100000 - i * 3000).toString(),
    rewardCut: i * 2 + 1,
    feeShare: 100 - (i * 2 + 1),
    thirtyDayVolumeETH: (1 - i * 0.05).toString(),
    sixtyDayVolumeETH: '0',
    ninetyDayVolumeETH: '0',
    totalVolumeETH: (10 - i * 0.5).toString(),
    delegatorCount: 50 - i * 2,
    lastRewardRound: `${4000 - i}`,
    serviceURI: null,
    activationRound: 1000,
    deactivationRound: 2_000_000_000,
    totalRewardTokens: '1000000000000000000000',
    rewardCallRatio: Math.max(0.8, 1 - i * 0.01),
    name: null,
  }));
}

describe('simulateMultiOrchestrator', () => {
  let simulateMultiOrchestrator: typeof import('../lib/multiOSimulatorService.js').simulateMultiOrchestrator;

  beforeEach(async () => {
    vi.resetModules();

    mockGetOrchestrators.mockResolvedValue(makeOrchestrators(20) as any);
    mockGetPrices.mockResolvedValue({
      lptUsd: 8.5,
      ethUsd: 3200,
      lptChange24h: 1.2,
      lptChange7d: 5.0,
      ethChange24h: -0.3,
      lptMarketCap: 250_000_000,
      lptVolume24h: 10_000_000,
      fetchedAt: new Date().toISOString(),
    } as any);
    mockGetProtocol.mockResolvedValue({
      inflation: '611000',
      inflationChange: '0',
      totalActiveStake: '26867853',
      totalSupply: '51509230',
      participationRate: 52,
      currentRound: 4000,
      roundLength: 5760,
      paused: false,
      lockPeriod: 2,
    } as any);

    const mod = await import('../lib/multiOSimulatorService.js');
    simulateMultiOrchestrator = mod.simulateMultiOrchestrator;
  });

  const defaultInput: MultiOInput = {
    amountLpt: 1000,
    durationMonths: 12,
    expectedReturnMin: 5,
    expectedReturnMax: 20,
  };

  it('returns exactly 3 strategies: high, medium, low', async () => {
    const result = await simulateMultiOrchestrator(defaultInput);

    expect(result.strategies).toHaveLength(3);
    expect(result.strategies[0].riskLevel).toBe('high');
    expect(result.strategies[1].riskLevel).toBe('medium');
    expect(result.strategies[2].riskLevel).toBe('low');
  });

  it('allocations within each strategy sum to 100%', async () => {
    const result = await simulateMultiOrchestrator({
      amountLpt: 5000,
      durationMonths: 6,
      expectedReturnMin: 0,
      expectedReturnMax: 100,
    });

    for (const strategy of result.strategies) {
      if (strategy.allocations.length > 0) {
        const sum = strategy.allocations.reduce((s, a) => s + a.allocationPct, 0);
        expect(sum).toBe(100);
      }
    }
  });

  it('each allocation LPT matches amountLpt * pct / 100', async () => {
    const result = await simulateMultiOrchestrator({
      amountLpt: 10000,
      durationMonths: 12,
      expectedReturnMin: 0,
      expectedReturnMax: 100,
    });

    for (const strategy of result.strategies) {
      for (const a of strategy.allocations) {
        const expected = parseFloat((10000 * a.allocationPct / 100).toFixed(4));
        expect(a.allocationLpt).toBeCloseTo(expected, 2);
      }
    }
  });

  it('all strategies have non-negative projected APR and return', async () => {
    const result = await simulateMultiOrchestrator(defaultInput);

    for (const strategy of result.strategies) {
      expect(strategy.projectedApr).toBeGreaterThanOrEqual(0);
      expect(strategy.projectedReturn).toBeGreaterThanOrEqual(0);
      expect(strategy.riskFactors.length).toBeGreaterThan(0);
    }
  });

  it('includes network average APR and price', async () => {
    const result = await simulateMultiOrchestrator(defaultInput);
    expect(result.networkAvgApr).toBeGreaterThan(0);
    expect(result.priceAtSimulation.lptUsd).toBe(8.5);
  });

  it('returns the original input in the result', async () => {
    const result = await simulateMultiOrchestrator(defaultInput);
    expect(result.input).toEqual(defaultInput);
  });

  it('throws on negative amount', async () => {
    await expect(
      simulateMultiOrchestrator({
        ...defaultInput,
        amountLpt: -100,
      }),
    ).rejects.toThrow('Amount must be positive');
  });

  it('throws on zero duration', async () => {
    await expect(
      simulateMultiOrchestrator({
        ...defaultInput,
        durationMonths: 0,
      }),
    ).rejects.toThrow('Duration must be positive');
  });

  it('handles empty orchestrator list gracefully', async () => {
    mockGetOrchestrators.mockResolvedValueOnce([] as any);

    const mod = await import('../lib/multiOSimulatorService.js');
    const result = await mod.simulateMultiOrchestrator(defaultInput);

    for (const strategy of result.strategies) {
      expect(strategy.allocations).toHaveLength(0);
      expect(strategy.projectedReturn).toBe(0);
    }
  });
});
