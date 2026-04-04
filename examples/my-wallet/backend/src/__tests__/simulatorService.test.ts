import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../lib/livepeer.js', () => ({
  getOrchestrators: vi.fn(),
}));

import { simulateRebalance } from '../lib/simulatorService.js';
import { getOrchestrators } from '../lib/livepeer.js';

const getOrchsMock = getOrchestrators as ReturnType<typeof vi.fn>;

const ADDR_FROM = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const ADDR_TO = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

function makeOrch(address: string, rewardCut: number, feeShare = 50) {
  return {
    address,
    active: true,
    totalStake: '100000',
    rewardCut,
    feeShare,
    thirtyDayVolumeETH: '0',
    sixtyDayVolumeETH: '0',
    ninetyDayVolumeETH: '0',
    totalVolumeETH: '0',
    delegatorCount: 10,
    lastRewardRound: '1000',
    serviceURI: null,
    activationRound: 1,
    deactivationRound: 2000000000,
    totalRewardTokens: '0',
    rewardCallRatio: 1,
  };
}

beforeEach(() => {
  getOrchsMock.mockReset();
  getOrchsMock.mockResolvedValue([
    makeOrch(ADDR_FROM, 50),
    makeOrch(ADDR_TO, 10),
  ]);
});

const BASE_INPUT = {
  fromOrchestrator: ADDR_FROM,
  toOrchestrator: ADDR_TO,
  amountWei: '1000000000000000000000', // 1000 LPT
  unbondingPeriodDays: 7,
};

describe('simulateRebalance', () => {
  it('throws for unknown fromOrchestrator', async () => {
    await expect(
      simulateRebalance({ ...BASE_INPUT, fromOrchestrator: '0x0000000000000000000000000000000000000001' }),
    ).rejects.toThrow('not found');
  });

  it('throws for unknown toOrchestrator', async () => {
    await expect(
      simulateRebalance({ ...BASE_INPUT, toOrchestrator: '0x0000000000000000000000000000000000000001' }),
    ).rejects.toThrow('not found');
  });

  it('returns "favorable" when moving to lower reward cut', async () => {
    // from rewardCut=50 → to rewardCut=10 (delegator keeps more)
    const result = await simulateRebalance(BASE_INPUT);
    expect(result.recommendation).toBe('favorable');
  });

  it('returns "unfavorable" when moving to higher reward cut', async () => {
    const result = await simulateRebalance({
      ...BASE_INPUT,
      fromOrchestrator: ADDR_TO,   // rewardCut=10
      toOrchestrator: ADDR_FROM,   // rewardCut=50
    });
    expect(result.recommendation).toBe('unfavorable');
  });

  it('correctly calculates unbonding opportunity cost', async () => {
    const result = await simulateRebalance(BASE_INPUT);

    // toDelegatorPct = (100 - 10) / 100 = 0.9
    // dailyReward = (1000 * 0.12 * 0.9) / 365 = 108/365
    // opportunityCost = (108/365) * 7 = 756/365 ≈ 2.0712
    expect(result.unbondingOpportunityCost).toBeCloseTo(2.0712, 3);
  });

  it('calculates amountLpt correctly from wei', async () => {
    const result = await simulateRebalance(BASE_INPUT);

    // 1000000000000000000000 wei / 1e18 = 1000 LPT
    expect(result.amountLpt).toBe(1000);
  });
});
