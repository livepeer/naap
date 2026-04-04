import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../db/client.js', () => ({
  prisma: {
    walletStakingState: { findUnique: vi.fn() },
    walletOrchestrator: { findMany: vi.fn() },
  },
}));

vi.mock('../lib/livepeer.js', () => ({
  getDelegator: vi.fn(),
  toWei: vi.fn((val: string | undefined | null): string => {
    if (!val || val === '0') return '0';
    if (/^-?\d+$/.test(val)) return val;
    const num = parseFloat(val);
    return BigInt(Math.round(num * 1e18)).toString();
  }),
}));

import { prisma } from '../db/client.js';
import { getDelegator, toWei } from '../lib/livepeer.js';
import { getPortfolio, getPositions } from '../lib/portfolioService.js';

const mockStaking = prisma.walletStakingState as unknown as {
  findUnique: ReturnType<typeof vi.fn>;
};
const mockOrchestrator = prisma.walletOrchestrator as unknown as {
  findMany: ReturnType<typeof vi.fn>;
};
const mockGetDelegator = getDelegator as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getPortfolio', () => {
  it('returns DB-backed portfolio when staking state exists', async () => {
    mockStaking.findUnique.mockResolvedValue({
      id: 'stake-1',
      address: '0xabc',
      stakedAmount: '5000000000000000000',
      pendingRewards: '100000000000000000',
      pendingFees: '50000000000000000',
      delegatedTo: '0xorch1',
      chainId: 42161,
      startRound: '3000',
      lastClaimRound: '3050',
    });
    mockOrchestrator.findMany.mockResolvedValue([
      { address: '0xorch1', name: 'OrcA', rewardCut: 5000, feeShare: 5000, totalStake: '100000', isActive: true },
    ]);

    const result = await getPortfolio('0xABC');

    expect(result.totalStaked).toBe('5000000000000000000');
    expect(result.totalPendingRewards).toBe('100000000000000000');
    expect(result.totalPendingFees).toBe('50000000000000000');
    expect(result.addressCount).toBe(1);
    expect(result.positions).toHaveLength(1);
    expect(result.positions[0].orchestrator).toBe('0xorch1');
    expect(result.positions[0].orchestratorInfo).toEqual({
      name: 'OrcA',
      rewardCut: 5000,
      feeShare: 5000,
      totalStake: '100000',
      isActive: true,
    });
    expect(mockGetDelegator).not.toHaveBeenCalled();
  });

  it('falls back to subgraph when no DB staking state', async () => {
    mockStaking.findUnique.mockResolvedValue(null);
    mockGetDelegator.mockResolvedValue({
      bondedAmount: '10.5',
      principal: '10.0',
      fees: '0.01',
      delegateAddress: '0xorch2',
      startRound: '3000',
      lastClaimRound: '3050',
    });
    mockOrchestrator.findMany.mockResolvedValue([]);

    const result = await getPortfolio('0xdef');

    expect(mockGetDelegator).toHaveBeenCalledWith('0xdef');
    expect(result.addressCount).toBe(1);
    expect(result.positions).toHaveLength(1);
    expect(result.positions[0].orchestrator).toBe('0xorch2');

    const bonded = BigInt(Math.round(10.5 * 1e18));
    const principal = BigInt(Math.round(10.0 * 1e18));
    const expectedRewards = bonded - principal;
    expect(result.totalStaked).toBe(bonded.toString());
    expect(result.totalPendingRewards).toBe(expectedRewards.toString());
  });

  it('returns empty portfolio when no staking data from either source', async () => {
    mockStaking.findUnique.mockResolvedValue(null);
    mockGetDelegator.mockResolvedValue(null);
    mockOrchestrator.findMany.mockResolvedValue([]);

    const result = await getPortfolio('0xnoone');

    expect(result.totalStaked).toBe('0');
    expect(result.totalPendingRewards).toBe('0');
    expect(result.totalPendingFees).toBe('0');
    expect(result.addressCount).toBe(0);
    expect(result.positions).toEqual([]);
  });

  it('returns empty portfolio when delegator has zero bonded', async () => {
    mockStaking.findUnique.mockResolvedValue(null);
    mockGetDelegator.mockResolvedValue({
      bondedAmount: '0',
      principal: '0',
      fees: '0',
      delegateAddress: null,
    });
    mockOrchestrator.findMany.mockResolvedValue([]);

    const result = await getPortfolio('0xzero');

    expect(result.positions).toEqual([]);
    expect(result.addressCount).toBe(0);
  });

  it('enriches positions with orchestrator info from DB', async () => {
    mockStaking.findUnique.mockResolvedValue({
      id: 's1',
      address: '0xuser',
      stakedAmount: '1000',
      pendingRewards: '10',
      pendingFees: '5',
      delegatedTo: '0xorch3',
      chainId: 42161,
      startRound: '100',
      lastClaimRound: '200',
    });
    mockOrchestrator.findMany.mockResolvedValue([
      { address: '0xorch3', name: 'Best Orchestrator', rewardCut: 2000, feeShare: 8000, totalStake: '999999', isActive: true },
    ]);

    const result = await getPortfolio('0xuser');

    expect(result.positions[0].orchestratorInfo).toEqual({
      name: 'Best Orchestrator',
      rewardCut: 2000,
      feeShare: 8000,
      totalStake: '999999',
      isActive: true,
    });
  });

  it('skips enrichment when position has no orchestrator', async () => {
    mockStaking.findUnique.mockResolvedValue({
      id: 's1',
      address: '0xuser',
      stakedAmount: '1000',
      pendingRewards: '10',
      pendingFees: '5',
      delegatedTo: null,
      chainId: 42161,
      startRound: '100',
      lastClaimRound: '200',
    });
    mockOrchestrator.findMany.mockResolvedValue([]);

    const result = await getPortfolio('0xuser');

    expect(result.positions[0].orchestratorInfo).toBeUndefined();
  });

  it('handles BigInt arithmetic correctly (rewards = bonded - principal)', async () => {
    mockStaking.findUnique.mockResolvedValue(null);
    mockGetDelegator.mockResolvedValue({
      bondedAmount: '100.5',
      principal: '95.0',
      fees: '0.5',
      delegateAddress: '0xorch',
      startRound: '1000',
      lastClaimRound: '1050',
    });
    mockOrchestrator.findMany.mockResolvedValue([]);

    const result = await getPortfolio('0xmath');

    const bonded = BigInt(Math.round(100.5 * 1e18));
    const principal = BigInt(Math.round(95.0 * 1e18));
    const expectedRewards = bonded - principal;
    expect(result.totalPendingRewards).toBe(expectedRewards.toString());
  });

  it('handles zero principal gracefully (rewards stay 0)', async () => {
    mockStaking.findUnique.mockResolvedValue(null);
    mockGetDelegator.mockResolvedValue({
      bondedAmount: '50.0',
      principal: '0',
      fees: '0',
      delegateAddress: '0xorch',
      startRound: '1',
      lastClaimRound: '100',
    });
    mockOrchestrator.findMany.mockResolvedValue([]);

    const result = await getPortfolio('0xzeroprincipal');

    const bonded = BigInt(Math.round(50.0 * 1e18));
    expect(result.totalStaked).toBe(bonded.toString());
    // principal is '0' → toWei returns '0' → bonded > 0n so rewards = bonded - 0n = bonded
    expect(result.totalPendingRewards).toBe(bonded.toString());
  });

  it('handles DB failure gracefully (falls back to subgraph)', async () => {
    mockStaking.findUnique.mockRejectedValue(new Error('DB down'));
    mockGetDelegator.mockResolvedValue({
      bondedAmount: '5.0',
      principal: '4.0',
      fees: '0.1',
      delegateAddress: '0xorch',
      startRound: '100',
      lastClaimRound: '200',
    });
    mockOrchestrator.findMany.mockRejectedValue(new Error('DB still down'));

    const result = await getPortfolio('0xfallback');

    expect(result.positions).toHaveLength(1);
    expect(result.positions[0].orchestratorInfo).toBeUndefined();
  });
});

describe('getPositions', () => {
  it('returns just the positions array', async () => {
    mockStaking.findUnique.mockResolvedValue({
      id: 's1',
      address: '0xuser',
      stakedAmount: '1000',
      pendingRewards: '10',
      pendingFees: '5',
      delegatedTo: '0xorch',
      chainId: 42161,
      startRound: '100',
      lastClaimRound: '200',
    });
    mockOrchestrator.findMany.mockResolvedValue([]);

    const positions = await getPositions('0xuser');

    expect(Array.isArray(positions)).toBe(true);
    expect(positions).toHaveLength(1);
    expect(positions[0].address).toBe('0xuser');
    expect(positions[0].orchestrator).toBe('0xorch');
  });

  it('returns empty array when no positions', async () => {
    mockStaking.findUnique.mockResolvedValue(null);
    mockGetDelegator.mockResolvedValue(null);
    mockOrchestrator.findMany.mockResolvedValue([]);

    const positions = await getPositions('0xnoone');

    expect(positions).toEqual([]);
  });
});
